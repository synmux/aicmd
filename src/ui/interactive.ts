/**
 * Interactive mode: generate several candidate commands, then let the user
 * pick one (and optionally edit it) before running it.
 *
 * The picker is a Clack `SelectPrompt` with a custom frame: every candidate
 * shows its command and, underneath, its explanation (or danger reason), so
 * the user can compare them without moving the cursor. Key handling is
 * Clack's (↑/↓, j/k, Enter, Escape, Ctrl-C) plus two of our own: `e` to
 * edit the highlighted candidate and `q` to cancel.
 *
 * Choosing a dangerous candidate with ⏎ does not run it immediately: the
 * picker closes and the normal warning + [y/N/e] confirmation appears, so a
 * destructive command always costs a second deliberate keypress.
 */
import type { Writable } from "node:stream";
import { styleText } from "node:util";
import { isCancel, SelectPrompt } from "@clack/core";
import {
  limitOptions,
  S_BAR,
  S_BAR_END,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  S_STEP_ACTIVE,
  S_STEP_CANCEL,
  S_STEP_SUBMIT,
} from "@clack/prompts";
import { runCommand } from "../cli.ts";
import { gatherContext, resolveShell } from "../context.ts";
import { type GenerateResult, generateCommands } from "../generate.ts";
import { assessDanger, effectivePatterns } from "../safety.ts";
import type { Config, DangerAssessment, GeneratedCommand } from "../types.ts";
import {
  CHROME_STREAM,
  printCancelled,
  printCommandBlock,
  printDangerWarning,
  printIntro,
  printMuted,
} from "./chrome.ts";
import { confirmRun, editInEditor, type PromptStreams } from "./prompt.ts";
import { Spinner } from "./spinner.ts";

export interface InteractiveOptions {
  verbose: boolean;
  force: boolean;
  spinnerEnabled: boolean;
  abortController: AbortController;
}

/** One candidate paired with its local + model danger verdict. */
export interface PickerEntry {
  candidate: GeneratedCommand;
  danger: DangerAssessment;
}

export type Selection = { action: "run" | "edit"; index: number } | { action: "cancel" };

/** The list label for a candidate: the command, danger-marked when needed. */
export function pickerEntryLabel(entry: PickerEntry): string {
  return entry.danger.dangerous ? `⚠ ${entry.candidate.command}` : entry.candidate.command;
}

/** The one-line description under a candidate: explanation and/or danger reason. */
export function pickerEntryDescription(entry: PickerEntry): string {
  const explanation = entry.candidate.explanation;
  if (!entry.danger.dangerous) return explanation;
  const reason = entry.danger.reasons[0] ?? "potentially destructive";
  return explanation ? `⚠ ${reason} — ${explanation}` : `⚠ ${reason}`;
}

/** Run the full interactive flow. Returns a process exit code. */
export async function runInteractive(task: string, config: Config, opts: InteractiveOptions): Promise<number> {
  const count = Math.max(1, config.interactiveCount);
  const shellPath = resolveShell(config.shell);
  const spinner = new Spinner(opts.spinnerEnabled && process.stderr.isTTY, config.spinner);

  printIntro();
  spinner.start(`Generating ${count} option${count === 1 ? "" : "s"}`);
  let result: GenerateResult;
  try {
    result = await generateCommands(task, config, {
      count,
      contextBlock: gatherContext(config),
      shellPath,
      progress: { onPhase: (label) => spinner.update(label) },
      abortController: opts.abortController,
      ...(opts.verbose ? { onStderr: (data: string) => process.stderr.write(data) } : {}),
    });
  } catch (err) {
    spinner.stop();
    throw err;
  }
  spinner.stop();

  if (opts.verbose) {
    printMuted(`cost $${result.costUsd.toFixed(4)}${result.model ? ` (${result.model})` : ""}`);
  }

  const patterns = effectivePatterns(config);
  const entries: PickerEntry[] = result.candidates.map((candidate) => ({
    candidate,
    danger: assessDanger(candidate, patterns),
  }));

  // A human confirms every run in this mode, but a degraded danger signal
  // (plain-text fallback: no model self-assessment) is still worth a note.
  if (entries.some((entry) => !entry.danger.modelSignalAvailable)) {
    printMuted(
      "Note: the model's danger self-assessment was unavailable " +
        "(plain-text fallback); only local guard patterns were applied.",
    );
  }

  const selection = await selectCommand(entries);

  if (selection.action === "cancel") {
    printCancelled("Cancelled. Nothing was executed.");
    return 1;
  }

  const entry = entries[selection.index];
  if (entry === undefined) {
    // The picker only ever returns indices into `entries`; anything else is
    // a programming error, and failing loudly beats running the wrong command.
    throw new Error(`Picker returned out-of-range index ${selection.index}`);
  }
  let command = entry.candidate.command;

  if (selection.action === "edit") {
    command = (await editInEditor(command)).trim();
    if (command === "") {
      printCancelled("Cancelled: empty command.");
      return 1;
    }
    warnIfEditedDangerous(command, patterns);
    return await runCommand(command, shellPath);
  }

  // ⏎ on a dangerous candidate: one keypress must not be enough. Show the
  // full warning and require the usual confirmation.
  if (entry.danger.dangerous) {
    printCommandBlock(command);
    printDangerWarning(entry.danger);
    const choice = await confirmRun();
    if (choice === "no") {
      printCancelled("Cancelled. Nothing was executed.");
      return 1;
    }
    if (choice === "edit") {
      command = (await editInEditor(command)).trim();
      if (command === "") {
        printCancelled("Cancelled: empty command.");
        return 1;
      }
      warnIfEditedDangerous(command, patterns);
    }
  }

  return await runCommand(command, shellPath);
}

/** Warn (but do not block) when a user-edited command trips the guard patterns. */
function warnIfEditedDangerous(command: string, patterns: string[]): void {
  const danger = assessDanger({ command, explanation: "", dangerous: false }, patterns);
  if (danger.dangerous) printDangerWarning(danger);
}

/**
 * Rows the frame uses besides the candidate list (leading bar, header,
 * closing bar, and the prompt's trailing newline); the list is capped to
 * what remains of the terminal and scrolls inside that.
 */
const PICKER_CHROME_ROWS = 4;

export interface PickerFrame {
  entries: PickerEntry[];
  cursor: number;
  state: "initial" | "active" | "submit" | "cancel" | "error" | "validating";
  /** The stream the frame will be drawn on; its size decides the scroll window. */
  output: Writable;
}

/** One candidate as two rows: the (marked) command, then its description. */
function formatPickerItem(entry: PickerEntry, active: boolean): string {
  const label = pickerEntryLabel(entry);
  const marker = active ? styleText("green", S_RADIO_ACTIVE) : styleText("dim", S_RADIO_INACTIVE);
  const command = entry.danger.dangerous ? styleText("yellow", label) : active ? label : styleText("dim", label);
  const description = pickerEntryDescription(entry);
  const detail = description === "" ? "" : `\n  ${styleText("dim", description)}`;
  return `${marker} ${command}${detail}`;
}

/**
 * The picker's frame, extracted as a pure function so its content can be
 * asserted on without a terminal. Overflow is handled by Clack's
 * `limitOptions`, which keeps the cursor in view and marks hidden rows.
 */
export function renderPickerFrame(frame: PickerFrame): string {
  const question = "Pick a command";
  const grayBar = styleText("gray", S_BAR);
  const chosen = frame.entries[frame.cursor];
  const chosenLabel = chosen === undefined ? "" : pickerEntryLabel(chosen);

  if (frame.state === "submit") {
    return `${grayBar}\n${styleText("green", S_STEP_SUBMIT)}  ${question}\n${grayBar}  ${styleText("dim", chosenLabel)}`;
  }
  if (frame.state === "cancel") {
    return `${grayBar}\n${styleText("red", S_STEP_CANCEL)}  ${question}\n${grayBar}  ${styleText(["strikethrough", "dim"], chosenLabel)}`;
  }

  const help = styleText("dim", "↑/↓ move · ⏎ run · e edit · q cancel");
  const prefix = `${styleText("cyan", S_BAR)}  `;
  const rows = limitOptions({
    cursor: frame.cursor,
    options: frame.entries,
    output: frame.output,
    rowPadding: PICKER_CHROME_ROWS,
    columnPadding: prefix.length,
    style: formatPickerItem,
  });
  return [
    grayBar,
    `${styleText("cyan", S_STEP_ACTIVE)}  ${question}  ${help}`,
    ...rows.map((row) => `${prefix}${row}`),
    styleText("cyan", S_BAR_END),
  ].join("\n");
}

/**
 * Show the picker and resolve with the user's choice. Streams default to
 * stdin and stderr; tests inject fakes.
 */
export async function selectCommand(entries: PickerEntry[], streams: PromptStreams = {}): Promise<Selection> {
  const output = streams.output ?? CHROME_STREAM;
  let action: "run" | "edit" = "run";
  const prompt = new SelectPrompt<{ value: number }>({
    options: entries.map((_entry, index) => ({ value: index })),
    initialValue: 0,
    input: streams.input ?? process.stdin,
    output,
    render() {
      return renderPickerFrame({ entries, cursor: this.cursor, state: this.state, output });
    },
  });
  prompt.on("key", (char) => {
    if (char === "e") {
      action = "edit";
      prompt.state = "submit";
    } else if (char === "q") {
      prompt.state = "cancel";
    }
  });

  const value = await prompt.prompt();
  if (isCancel(value) || value === undefined) return { action: "cancel" };
  return { action, index: value };
}
