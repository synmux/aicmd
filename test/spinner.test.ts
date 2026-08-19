import { test, expect, describe } from "bun:test";
import spinners from "cli-spinners";
import {
  DEFAULT_SPINNER,
  isSpinnerName,
  resolveSpinner,
} from "../src/ui/spinner.ts";

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
    expect(resolveSpinner("nope-not-a-spinner")).toBe(
      spinners[DEFAULT_SPINNER],
    );
  });
});
