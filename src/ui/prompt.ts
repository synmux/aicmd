/**
 * Terminal input helpers: asking for the task when argv is empty, reading a
 * piped task from stdin, the run confirmation prompt, and `$EDITOR`
 * integration for tweaking a command before it runs.
 *
 * Prompts are built on Clack primitives and render to **stderr**, keeping
 * stdout for the command alone. Every prompt accepts its streams so tests
 * can drive it through fakes.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
import { isCancel, SelectKeyPrompt } from "@clack/core";
import { S_BAR, S_BAR_END, S_STEP_ACTIVE, S_STEP_CANCEL, S_STEP_SUBMIT, text } from "@clack/prompts";
import { AicmdError } from "../errors.ts";
import { CHROME_STREAM } from "./chrome.ts";

/** Streams a prompt reads from and renders to; defaults are stdin and stderr. */
export interface PromptStreams {
  input?: Readable;
  output?: Writable;
}

/** Resolve the editor command, mirroring git's lookup order. */
export function resolveEditor(env: Record<string, string | undefined> = process.env): string {
  return env.GIT_EDITOR || env.VISUAL || env.EDITOR || "vi";
}

/** Ask for the task interactively (stderr prompt, requires a TTY on stdin). */
export async function askTask(streams: PromptStreams = {}): Promise<string> {
  const answer = await text({
    message: "What should the command do?",
    placeholder: "e.g. list the five largest files here",
    input: streams.input ?? process.stdin,
    output: streams.output ?? CHROME_STREAM,
  });
  return isCancel(answer) ? "" : answer.trim();
}

/** Read the whole of stdin as the task (for `echo task | aicmd`). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export type ConfirmChoice = "yes" | "no" | "edit";

/**
 * Map one typed answer to a confirm choice, or `null` when unrecognised.
 * The default (empty answer) is **No**: running a generated shell command
 * should take a deliberate keypress.
 */
export function parseConfirmAnswer(answer: string): ConfirmChoice | null {
  const normalised = answer.trim().toLowerCase();
  if (normalised === "y" || normalised === "yes") return "yes";
  if (normalised === "" || normalised === "n" || normalised === "no") {
    return "no";
  }
  if (normalised === "e" || normalised === "edit") return "edit";
  return null;
}

const CONFIRM_LABELS: Record<ConfirmChoice, string> = { yes: "Yes", no: "No", edit: "Edit" };

export interface ConfirmFrame {
  state: "initial" | "active" | "submit" | "cancel" | "error" | "validating";
  choice?: ConfirmChoice;
}

/**
 * The confirm prompt's frame, extracted as a pure function so its content
 * can be asserted on without a terminal. While open it lists the keys; once
 * settled it collapses to the answer.
 */
export function renderConfirmFrame(frame: ConfirmFrame): string {
  const question = "Run this command?";
  const bar = styleText("gray", S_BAR);
  if (frame.state === "submit" || frame.state === "cancel") {
    const symbol = frame.state === "submit" ? styleText("green", S_STEP_SUBMIT) : styleText("red", S_STEP_CANCEL);
    const answer = CONFIRM_LABELS[frame.choice ?? "no"];
    return `${bar}\n${symbol}  ${question} ${styleText("dim", answer)}`;
  }
  const key = (letter: string, label: string): string => `${styleText("bold", letter)} ${label}`;
  const options = [key("y", "Yes"), key("n", "No"), key("e", "Edit")].join(styleText("dim", " · "));
  const hint = styleText("dim", "(Enter = No)");
  return [
    bar,
    `${styleText("cyan", S_STEP_ACTIVE)}  ${question}`,
    `${styleText("cyan", S_BAR)}  ${options}  ${hint}`,
    styleText("cyan", S_BAR_END),
  ].join("\n");
}

/**
 * Prompt for [y]es / [N]o / [e]dit on stderr. A single keypress answers;
 * Enter alone, Escape, Ctrl-C and EOF all mean **No**.
 */
export async function confirmRun(streams: PromptStreams = {}): Promise<ConfirmChoice> {
  let choice: ConfirmChoice | undefined;
  const prompt = new SelectKeyPrompt<{ value: ConfirmChoice }>({
    // Clack keys each option on the first character of its value (n/y/e).
    // Enter submits without a key: the prompt resolves `undefined`, which
    // is mapped to No below - the default must never be Yes.
    options: [{ value: "no" }, { value: "yes" }, { value: "edit" }],
    initialValue: "no",
    input: streams.input ?? process.stdin,
    output: streams.output ?? CHROME_STREAM,
    render() {
      return renderConfirmFrame({ state: this.state, ...(choice !== undefined ? { choice } : {}) });
    },
  });
  prompt.on("key", (char) => {
    const parsed = typeof char === "string" && char !== "" ? parseConfirmAnswer(char) : null;
    if (parsed !== null) choice = parsed;
  });
  const answer = await prompt.prompt();
  if (isCancel(answer) || answer === undefined) return "no";
  return answer;
}

/** Open `initial` in the user's editor and return the saved contents. */
export async function editInEditor(initial: string): Promise<string> {
  const editor = resolveEditor();
  // Unpredictable name + exclusive create (`wx`) + owner-only perms (0o600)
  // so the temp file can't be pre-created as a symlink or read by other users.
  const file = join(tmpdir(), `aicmd-edit-${randomUUID()}.txt`);
  try {
    await writeFile(file, initial, { mode: 0o600, flag: "wx" });
  } catch (err) {
    throw new AicmdError(`Could not create a temporary file to edit the command: ${(err as Error).message}`);
  }
  try {
    await runEditor(editor, file);
    const edited = await readFile(file, "utf8");
    // Drop trailing whitespace/newline noise editors tend to add.
    return edited.replace(/\s+$/, "");
  } catch (err) {
    if (err instanceof AicmdError) throw err;
    throw new AicmdError(`Editing the command failed (${editor}): ${(err as Error).message}`);
  } finally {
    await unlink(file).catch(() => {});
  }
}

function runEditor(editor: string, file: string): Promise<void> {
  return new Promise((resolveEdit, reject) => {
    // $EDITOR / $GIT_EDITOR are shell command lines that may contain flags,
    // spaces in the program path, or quoted arguments (e.g. "code --wait" or
    // "/path/with spaces/editor"). Run them through the shell exactly as git
    // does rather than naively splitting on whitespace. The file path is our
    // own (tmpdir + UUID), so double-quoting it is safe.
    const child = spawn(`${editor} "${file}"`, {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) resolveEdit();
      else reject(new Error(`Editor exited with code ${code}`));
    });
  });
}
