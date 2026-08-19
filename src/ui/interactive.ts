/**
 * Interactive mode: generate several candidate commands, then let the user
 * pick one (and optionally edit it) before running it.
 *
 * The picker is an OpenTUI selection screen. All key handling is driven
 * through the renderer's global key handler so there is a single source of
 * truth for navigation. If the TUI cannot be initialized for any reason, we
 * transparently fall back to a plain readline prompt.
 *
 * Choosing a dangerous candidate with ⏎ does not run it immediately: the
 * picker closes and the normal warning + [y/N/e] confirmation appears, so a
 * destructive command always costs a second deliberate keypress.
 */
import { createInterface } from "node:readline";
import { printCommandBlock, printDangerWarning, runCommand } from "../cli.ts";
import { gatherContext, resolveShell } from "../context.ts";
import { generateCommands } from "../generate.ts";
import { assessDanger, effectivePatterns } from "../safety.ts";
import { color } from "./colors.ts";
import { askLine, confirmRun, editInEditor } from "./prompt.ts";
import { Spinner } from "./spinner.ts";
import type { Config, DangerAssessment, GeneratedCommand } from "../types.ts";

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

type Selection =
  { action: "run" | "edit"; index: number } | { action: "cancel" };

/** The list label for a candidate: the command, danger-marked when needed. */
export function pickerEntryLabel(entry: PickerEntry): string {
  return entry.danger.dangerous
    ? `⚠ ${entry.candidate.command}`
    : entry.candidate.command;
}

/** The one-line description under a candidate: explanation and/or danger reason. */
function pickerEntryDescription(entry: PickerEntry): string {
  const explanation = entry.candidate.explanation;
  if (!entry.danger.dangerous) return explanation;
  const reason = entry.danger.reasons[0] ?? "potentially destructive";
  return explanation ? `⚠ ${reason} — ${explanation}` : `⚠ ${reason}`;
}

/** Run the full interactive flow. Returns a process exit code. */
export async function runInteractive(
  task: string,
  config: Config,
  opts: InteractiveOptions,
): Promise<number> {
  const count = Math.max(1, config.interactiveCount);
  const shellPath = resolveShell(config.shell);
  const spinner = new Spinner(
    opts.spinnerEnabled && process.stderr.isTTY,
    config.spinner,
  );

  spinner.start(`Generating ${count} option${count === 1 ? "" : "s"}`);
  let result;
  try {
    result = await generateCommands(task, config, {
      count,
      contextBlock: gatherContext(config),
      shellPath,
      progress: { onPhase: (label) => spinner.update(label) },
      abortController: opts.abortController,
      ...(opts.verbose
        ? { onStderr: (data: string) => process.stderr.write(data) }
        : {}),
    });
  } catch (err) {
    spinner.stop();
    throw err;
  }
  spinner.stop();

  if (opts.verbose) {
    process.stderr.write(
      color(
        "90",
        `cost $${result.costUsd.toFixed(4)}${result.model ? ` (${result.model})` : ""}`,
      ) + "\n",
    );
  }

  const patterns = effectivePatterns(config);
  const entries: PickerEntry[] = result.candidates.map((candidate) => ({
    candidate,
    danger: assessDanger(candidate, patterns),
  }));

  // A human confirms every run in this mode, but a degraded danger signal
  // (plain-text fallback: no model self-assessment) is still worth a note.
  if (entries.some((entry) => !entry.danger.modelSignalAvailable)) {
    process.stderr.write(
      color(
        "90",
        "Note: the model's danger self-assessment was unavailable " +
          "(plain-text fallback); only local guard patterns were applied.",
      ) + "\n",
    );
  }

  let selection: Selection;
  try {
    selection = await selectWithTui(entries);
  } catch {
    // TUI failed to initialize (unusual terminal, etc.) - degrade gracefully.
    selection = await selectWithReadline(entries);
  }

  if (selection.action === "cancel") {
    process.stderr.write("Cancelled. Nothing was executed.\n");
    return 1;
  }

  const entry = entries[selection.index]!;
  let command = entry.candidate.command;

  if (selection.action === "edit") {
    command = (await editInEditor(command)).trim();
    if (command === "") {
      process.stderr.write("Cancelled: empty command.\n");
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
    process.stderr.write("\n");
    const choice = await confirmRun();
    if (choice === "no") {
      process.stderr.write("Cancelled. Nothing was executed.\n");
      return 1;
    }
    if (choice === "edit") {
      command = (await editInEditor(command)).trim();
      if (command === "") {
        process.stderr.write("Cancelled: empty command.\n");
        return 1;
      }
      warnIfEditedDangerous(command, patterns);
    }
  }

  return await runCommand(command, shellPath);
}

/** Warn (but do not block) when a user-edited command trips the guard patterns. */
function warnIfEditedDangerous(command: string, patterns: string[]): void {
  const danger = assessDanger(
    { command, explanation: "", dangerous: false },
    patterns,
  );
  if (danger.dangerous) printDangerWarning(danger);
}

/**
 * Rows a single candidate occupies in the picker: the command line plus a
 * one-line description (`showDescription`), with OpenTUI's default
 * `itemSpacing` of 0. Mirrors SelectRenderable's own line accounting.
 */
const PICKER_LINES_PER_ITEM = 2;

/**
 * Rows reserved for the non-picker chrome when capping its height: root
 * padding (2), the header line (1) and the gap below it (1).
 */
const PICKER_CHROME_ROWS = 4;

/**
 * The picker's height, sized to its content (two rows per candidate) but
 * capped to the terminal so a large `interactiveCount` still fits; past the
 * cap the list scrolls internally (see `showScrollIndicator` in
 * {@link buildPickerScene}). An explicit height keeps the picker compact -
 * only as tall as the options need - rather than stretching to fill the
 * screen.
 */
export function pickerHeight(count: number, terminalRows: number): number {
  const wanted = Math.max(1, count) * PICKER_LINES_PER_ITEM;
  const cap = Math.max(
    PICKER_LINES_PER_ITEM,
    terminalRows - PICKER_CHROME_ROWS,
  );
  return Math.min(wanted, cap);
}

/** The `@opentui/core` module, however it is obtained (dynamic import or test). */
type TuiModule = typeof import("@opentui/core");
/** The renderer object returned by `createCliRenderer` (and the headless test renderer). */
type TuiRenderer = Awaited<ReturnType<TuiModule["createCliRenderer"]>>;

/** The renderables the caller wires key handling to after building the scene. */
export interface PickerScene {
  root: InstanceType<TuiModule["BoxRenderable"]>;
  select: InstanceType<TuiModule["SelectRenderable"]>;
}

/**
 * Build the picker's renderable tree: a header line above the candidate list.
 * Extracted from {@link selectWithTui} so the layout can be rendered under
 * OpenTUI's headless test renderer and asserted on. The caller adds `root` to
 * the renderer and wires key handling to the returned `select`.
 */
export function buildPickerScene(
  renderer: TuiRenderer,
  tui: TuiModule,
  entries: PickerEntry[],
  terminalRows: number,
): PickerScene {
  const { BoxRenderable, TextRenderable, SelectRenderable } = tui;

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    gap: 1,
  });

  const header = new TextRenderable(renderer, {
    content: "Pick a command   ↑/↓ select · ⏎ run · e edit · q cancel",
  });

  // A compact, content-sized list of the candidates. flexShrink:0 keeps it at
  // its full height; showScrollIndicator covers more options than fit.
  const select = new SelectRenderable(renderer, {
    height: pickerHeight(entries.length, terminalRows),
    flexShrink: 0,
    showScrollIndicator: true,
    options: entries.map((entry, index) => ({
      name: pickerEntryLabel(entry),
      description: pickerEntryDescription(entry),
      value: index,
    })),
    selectedIndex: 0,
    showDescription: true,
    wrapSelection: true,
    // A calm slate highlight (OpenTUI's own default background) with soft
    // near-white text. The default description greys read fine on the slate.
    selectedBackgroundColor: "#334455",
    selectedTextColor: "#e6edf3",
  });

  root.add(header);
  root.add(select);

  return { root, select };
}

/** The OpenTUI selection screen. Resolves with the user's choice. */
async function selectWithTui(entries: PickerEntry[]): Promise<Selection> {
  const tui = await import("@opentui/core");
  const renderer = await tui.createCliRenderer({ exitOnCtrlC: false });

  return await new Promise<Selection>((resolve, reject) => {
    let settled = false;
    let onKey: (key: { name?: string; ctrl?: boolean }) => void = () => {};

    const cleanup = () => {
      try {
        renderer.keyInput.off("keypress", onKey);
      } catch {
        /* ignore */
      }
      try {
        renderer.destroy();
      } catch {
        /* ignore */
      }
    };
    const finish = (selection: Selection) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(selection);
    };

    try {
      const terminalRows = process.stdout.rows ?? 24;
      const { root, select } = buildPickerScene(
        renderer,
        tui,
        entries,
        terminalRows,
      );
      renderer.root.add(root);

      onKey = (key) => {
        if (!key) return; // some terminals can emit empty/unknown key events
        try {
          switch (key.name) {
            case "up":
            case "k":
              select.moveUp();
              renderer.requestRender();
              break;
            case "down":
            case "j":
              select.moveDown();
              renderer.requestRender();
              break;
            case "return":
            case "enter":
              finish({ action: "run", index: select.getSelectedIndex() });
              break;
            case "e":
              finish({ action: "edit", index: select.getSelectedIndex() });
              break;
            case "q":
            case "escape":
              finish({ action: "cancel" });
              break;
            case "c":
              if (key.ctrl) finish({ action: "cancel" });
              break;
          }
        } catch {
          // A renderable method threw unexpectedly. Rather than let the error
          // escape the key handler and leave the terminal stuck in raw mode,
          // cancel cleanly - finish() restores the terminal via cleanup().
          finish({ action: "cancel" });
        }
      };

      renderer.keyInput.on("keypress", onKey);
      renderer.start();
      renderer.requestRender();
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/** Plain-prompt fallback when the TUI is unavailable. */
async function selectWithReadline(entries: PickerEntry[]): Promise<Selection> {
  process.stderr.write("\nCandidate commands:\n");
  entries.forEach((entry, index) => {
    process.stderr.write(`  ${index + 1}. ${pickerEntryLabel(entry)}\n`);
    const description = pickerEntryDescription(entry);
    if (description !== "") {
      process.stderr.write(color("90", `     ${description}`) + "\n");
    }
  });

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (;;) {
      const raw = await askLine(
        rl,
        `Choose 1-${entries.length}, "e N" to edit, or q to quit: `,
      );
      if (raw === null) return { action: "cancel" };
      const answer = raw.trim().toLowerCase();

      if (answer === "q" || answer === "") return { action: "cancel" };

      const editMatch = answer.match(/^e\s*(\d+)$/);
      if (editMatch) {
        const index = parseInt(editMatch[1]!, 10) - 1;
        if (index >= 0 && index < entries.length)
          return { action: "edit", index };
      }

      const choice = parseInt(answer, 10);
      if (choice >= 1 && choice <= entries.length) {
        return { action: "run", index: choice - 1 };
      }
      process.stderr.write("Invalid choice.\n");
    }
  } finally {
    rl.close();
  }
}
