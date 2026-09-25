import spinners from "cli-spinners";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SPINNER, isSpinnerName, resolveSpinner, Spinner } from "../src/ui/spinner.ts";
import { fakeTerminal } from "./terminal.ts";

describe("isSpinnerName", () => {
  test("recognises bundled cli-spinners names", () => {
    expect(isSpinnerName("dots")).toBe(true);
    expect(isSpinnerName("material")).toBe(true);
    expect(isSpinnerName("nope-not-a-spinner")).toBe(false);
  });
});

describe("resolveSpinner", () => {
  test("returns the named animation", () => {
    expect(resolveSpinner("moon")).toBe(spinners.moon);
  });

  test("falls back to the default for unknown names", () => {
    expect(resolveSpinner("nope-not-a-spinner")).toBe(spinners[DEFAULT_SPINNER]);
  });
});

describe("Spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("when disabled, start and update are silent but final lines still print", () => {
    const terminal = fakeTerminal();
    const spinner = new Spinner(false, "dots", { output: terminal.output });
    spinner.start("Generating command");
    spinner.update("Still generating");
    expect(terminal.text()).toBe("");
    spinner.succeed("Generated");
    expect(terminal.text()).toContain("Generated");
    spinner.fail("Broke");
    expect(terminal.text()).toContain("Broke");
  });

  test("when enabled, animates the configured frames with the label", () => {
    const terminal = fakeTerminal();
    const spinner = new Spinner(true, "moon", { output: terminal.output });
    spinner.start("Generating command");
    vi.advanceTimersByTime(spinners.moon.interval * 3);
    const text = terminal.text();
    expect(text).toContain("Generating command");
    expect(spinners.moon.frames.some((frame) => text.includes(frame))).toBe(true);
    spinner.stop();
  });

  test("update swaps the label on the next frame", () => {
    const terminal = fakeTerminal();
    const spinner = new Spinner(true, "dots", { output: terminal.output });
    spinner.start("Phase one");
    vi.advanceTimersByTime(spinners.dots.interval);
    spinner.update("Phase two");
    vi.advanceTimersByTime(spinners.dots.interval);
    expect(terminal.text()).toContain("Phase two");
    spinner.stop();
  });

  test("stop clears the animation; succeed and fail print a closing line", () => {
    const terminal = fakeTerminal();
    const spinner = new Spinner(true, "dots", { output: terminal.output });
    spinner.start("Working");
    vi.advanceTimersByTime(spinners.dots.interval);
    spinner.stop();
    const afterStop = terminal.raw().length;
    vi.advanceTimersByTime(spinners.dots.interval * 5);
    // Nothing more is written once stopped.
    expect(terminal.raw().length).toBe(afterStop);

    spinner.start("Again");
    spinner.succeed("All done");
    expect(terminal.text()).toContain("All done");
    spinner.start("Once more");
    spinner.fail("Went wrong");
    expect(terminal.text()).toContain("Went wrong");
  });

  test("start while already spinning replaces the previous animation", () => {
    const terminal = fakeTerminal();
    const spinner = new Spinner(true, "dots", { output: terminal.output });
    spinner.start("First");
    spinner.start("Second");
    vi.advanceTimersByTime(spinners.dots.interval * 2);
    expect(terminal.text()).toContain("Second");
    expect(vi.getTimerCount()).toBe(1);
    spinner.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
