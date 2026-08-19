import { test, expect, describe } from "bun:test";
import { parseConfirmAnswer, resolveEditor } from "../src/ui/prompt.ts";

describe("parseConfirmAnswer", () => {
  test("defaults to no on an empty answer", () => {
    expect(parseConfirmAnswer("")).toBe("no");
    expect(parseConfirmAnswer("   ")).toBe("no");
  });

  test("maps the documented answers", () => {
    expect(parseConfirmAnswer("y")).toBe("yes");
    expect(parseConfirmAnswer("YES")).toBe("yes");
    expect(parseConfirmAnswer("n")).toBe("no");
    expect(parseConfirmAnswer("no")).toBe("no");
    expect(parseConfirmAnswer("e")).toBe("edit");
    expect(parseConfirmAnswer("edit")).toBe("edit");
  });

  test("anything else is unrecognised", () => {
    expect(parseConfirmAnswer("maybe")).toBeNull();
  });
});

describe("resolveEditor", () => {
  test("follows git's lookup order", () => {
    expect(
      resolveEditor({ GIT_EDITOR: "ge", VISUAL: "vi", EDITOR: "ed" }),
    ).toBe("ge");
    expect(resolveEditor({ VISUAL: "code --wait", EDITOR: "ed" })).toBe(
      "code --wait",
    );
    expect(resolveEditor({ EDITOR: "nano" })).toBe("nano");
    expect(resolveEditor({})).toBe("vi");
  });
});
