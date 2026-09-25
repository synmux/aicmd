import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { buildContextBlock, gatherContext, resolveShell, shellName } from "../src/context.ts";

describe("resolveShell", () => {
  test("config shell wins over $SHELL", () => {
    expect(resolveShell("/usr/bin/zsh", { SHELL: "/bin/bash" })).toBe("/usr/bin/zsh");
  });

  test("$SHELL is used when config has none", () => {
    expect(resolveShell(null, { SHELL: "/opt/homebrew/bin/fish" })).toBe("/opt/homebrew/bin/fish");
  });

  test("falls back to /bin/sh", () => {
    expect(resolveShell(null, {})).toBe("/bin/sh");
    expect(resolveShell(null, { SHELL: "" })).toBe("/bin/sh");
  });
});

describe("shellName", () => {
  test("returns the basename of a shell path", () => {
    expect(shellName("/opt/homebrew/bin/fish")).toBe("fish");
    expect(shellName("/bin/sh")).toBe("sh");
    expect(shellName("zsh")).toBe("zsh");
  });
});

describe("buildContextBlock", () => {
  const base = {
    platform: "darwin",
    release: "25.6.0",
    arch: "arm64",
    shellPath: "/opt/homebrew/bin/fish",
  };

  test("describes macOS with the BSD userland warning", () => {
    const block = buildContextBlock(base);
    expect(block).toContain("macOS");
    expect(block).toContain("arm64");
    expect(block).toContain("BSD");
  });

  test("describes Linux with a GNU userland note", () => {
    const block = buildContextBlock({
      ...base,
      platform: "linux",
      release: "6.9.0",
    });
    expect(block).toContain("Linux");
    expect(block).toContain("GNU");
    expect(block).not.toContain("BSD");
  });

  test("names the target shell and warns about fish syntax", () => {
    const block = buildContextBlock(base);
    expect(block).toContain("fish");
    expect(block).toMatch(/fish .*syntax|syntax.*fish/i);
  });

  test("plain POSIX shells get no fish warning", () => {
    const block = buildContextBlock({ ...base, shellPath: "/bin/bash" });
    expect(block).toContain("bash");
    expect(block).not.toMatch(/fish/);
  });
});

describe("gatherContext", () => {
  test("returns null when includeContext is off", () => {
    expect(gatherContext({ ...DEFAULT_CONFIG, includeContext: false }, { SHELL: "/bin/sh" })).toBeNull();
  });

  test("returns a populated block for the current machine", () => {
    const block = gatherContext(DEFAULT_CONFIG, { SHELL: "/bin/zsh" });
    expect(block).not.toBeNull();
    if (block === null) throw new Error("Expected context to be populated");
    expect(block).toContain("zsh");
  });
});
