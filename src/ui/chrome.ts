/**
 * The visual chrome around the generated command: the command block, the
 * danger warning, muted notes, refusals and the closing line before a run.
 *
 * Everything here renders with Clack's guide-bar aesthetic and defaults to
 * **stderr**, never stdout: only the command itself may be written to stdout
 * (see `runPlain` in src/cli.ts), so that `aicmd -d "..." | sh` composes.
 * Every helper takes the output stream as a parameter so tests can capture
 * it and so no call can accidentally reach `process.stdout` through Clack's
 * own default.
 *
 * The guide bar (the `│` running down the left) is drawn only when the
 * output is a terminal; piped stderr gets the same text as plain lines.
 */
import type { Writable } from "node:stream";
import { styleText } from "node:util";
import { cancel, intro, isTTY, log, note, outro } from "@clack/prompts";
import type { DangerAssessment } from "../types.ts";

/** The stream all chrome goes to unless a caller says otherwise. */
export const CHROME_STREAM: Writable = process.stderr;

/** Clack options for `output`: the stream, and the guide bar only on a TTY. */
function guide(output: Writable): { output: Writable; withGuide: boolean } {
  return { output, withGuide: isTTY(output) };
}

/** Dim text, via node:util so NO_COLOR and FORCE_COLOR are honoured. */
export function muted(text: string): string {
  return styleText("dim", text);
}

/** Open the guide bar with the program name. */
export function printIntro(title = "aicmd", output: Writable = CHROME_STREAM): void {
  intro(styleText("bold", title), guide(output));
}

/** Frame the command in a titled box so it stands apart from the chrome. */
export function printCommandBlock(command: string, output: Writable = CHROME_STREAM): void {
  note(command, "Command", guide(output));
}

/** A yellow warning: the first line is the headline, the rest its details. */
export function printWarning(lines: string[], output: Writable = CHROME_STREAM): void {
  log.warn(lines.map((line) => styleText("yellow", line)).join("\n"), guide(output));
}

/** The danger warning with its reasons. */
export function printDangerWarning(danger: Pick<DangerAssessment, "reasons">, output: Writable = CHROME_STREAM): void {
  printWarning(
    ["This command looks potentially destructive:", ...danger.reasons.map((reason) => `• ${reason}`)],
    output,
  );
}

/** A dim, low-emphasis line: explanations, cost, degraded-signal notes. */
export function printMuted(text: string, output: Writable = CHROME_STREAM): void {
  log.message(muted(text), guide(output));
}

/** A refusal: the first line is the headline, the rest explain what to do. */
export function printRefusal(lines: string[], output: Writable = CHROME_STREAM): void {
  const [headline = "", ...rest] = lines;
  log.error([styleText("red", headline), ...rest].join("\n"), guide(output));
}

/** Close the guide bar with a cancellation. */
export function printCancelled(message: string, output: Writable = CHROME_STREAM): void {
  cancel(message, guide(output));
}

/** Close the guide bar and announce the command that is about to run. */
export function printRunAnnouncement(command: string, output: Writable = CHROME_STREAM): void {
  outro(`${styleText("cyan", "▶")} ${command}`, guide(output));
}
