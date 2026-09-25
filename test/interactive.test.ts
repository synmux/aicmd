import { describe, expect, test } from "vitest";
import { type PickerEntry, pickerEntryLabel, renderPickerFrame, selectCommand } from "../src/ui/interactive.ts";
import { fakeTerminal, KEY, press } from "./terminal.ts";

const entry = (command: string, explanation: string, dangerous = false, reasons: string[] = []): PickerEntry => ({
  candidate: { command, explanation, dangerous, modelAssessed: true },
  danger: { dangerous, reasons, modelSignalAvailable: true },
});

const entries: PickerEntry[] = [
  entry("du -sh * | sort -h", "sorted sizes of everything here"),
  entry("find . -maxdepth 1 -size +100M", "finds large files"),
  entry("rm -rf ./cache", "clears the cache", true, ["matches guard pattern"]),
];

describe("pickerEntryLabel", () => {
  test("prefixes dangerous commands with a warning marker", () => {
    expect(pickerEntryLabel(entry("rm -rf /tmp/x", "removes", true))).toBe("⚠ rm -rf /tmp/x");
    expect(pickerEntryLabel(entry("ls -la", "lists"))).toBe("ls -la");
  });
});

describe("renderPickerFrame", () => {
  test("lists every candidate with its explanation", () => {
    const frame = renderPickerFrame({ entries, cursor: 0, state: "active", output: fakeTerminal().output });
    for (const item of entries) {
      expect(frame).toContain(item.candidate.command);
      expect(frame).toContain(item.candidate.explanation);
    }
  });

  test("marks dangerous candidates and shows the reason", () => {
    const frame = renderPickerFrame({ entries, cursor: 0, state: "active", output: fakeTerminal().output });
    expect(frame).toContain("⚠ rm -rf ./cache");
    expect(frame).toContain("matches guard pattern");
  });

  test("shows the key help", () => {
    const frame = renderPickerFrame({ entries, cursor: 0, state: "active", output: fakeTerminal().output });
    expect(frame).toContain("run");
    expect(frame).toContain("edit");
    expect(frame).toContain("cancel");
  });

  test("collapses to the chosen command once settled", () => {
    const frame = renderPickerFrame({ entries, cursor: 1, state: "submit", output: fakeTerminal().output });
    expect(frame).toContain("find . -maxdepth 1 -size +100M");
    expect(frame).not.toContain("du -sh * | sort -h");
  });

  test("scrolls when there are more candidates than rows", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      entry(`echo option number ${index + 1}`, `option ${index + 1}`),
    );
    const small = fakeTerminal({ rows: 12 }).output;
    const frame = renderPickerFrame({ entries: many, cursor: 0, state: "active", output: small });
    expect(frame).toContain("echo option number 1");
    expect(frame).not.toContain("echo option number 12");
    expect(frame).toContain("...");
  });
});

describe("selectCommand", () => {
  async function pick(...keys: string[]) {
    const terminal = fakeTerminal();
    const pending = selectCommand(entries, { input: terminal.input, output: terminal.output });
    await press(terminal.input, ...keys);
    return { selection: await pending, terminal };
  }

  test("Enter runs the highlighted candidate", async () => {
    const { selection } = await pick(KEY.down, KEY.down, KEY.enter);
    expect(selection).toEqual({ action: "run", index: 2 });
  });

  test("j/k move like the arrows and e edits the highlighted candidate", async () => {
    const { selection } = await pick("j", "e");
    expect(selection).toEqual({ action: "edit", index: 1 });
  });

  test("k from the top wraps to the last candidate", async () => {
    const { selection } = await pick("k", KEY.enter);
    expect(selection).toEqual({ action: "run", index: 2 });
  });

  test("q, Escape and Ctrl-C cancel", async () => {
    expect((await pick("q")).selection).toEqual({ action: "cancel" });
    expect((await pick(KEY.escape)).selection).toEqual({ action: "cancel" });
    expect((await pick(KEY.ctrlC)).selection).toEqual({ action: "cancel" });
  });

  test("renders the candidates while open", async () => {
    const { terminal } = await pick(KEY.enter);
    expect(terminal.text()).toContain("du -sh * | sort -h");
    expect(terminal.text()).toContain("sorted sizes of everything here");
  });
});
