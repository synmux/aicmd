import { describe, expect, test } from "vitest";
import { buildQueryOptions, buildSubprocessEnv, presentCredentialVars } from "../src/agent.ts";

const cleanEnv = { PATH: "/usr/bin", HOME: "/home/user" };

function expectDefined<Value>(value: Value | undefined): Value {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error("Expected value to be defined");
  return value;
}

describe("presentCredentialVars", () => {
  test("returns an empty list when no credential vars are set", () => {
    expect(presentCredentialVars(cleanEnv)).toEqual([]);
  });

  test("lists every credential var that is present", () => {
    expect(presentCredentialVars({ ...cleanEnv, ANTHROPIC_API_KEY: "sk-test" })).toEqual(["ANTHROPIC_API_KEY"]);
    expect(
      presentCredentialVars({
        ...cleanEnv,
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_AUTH_TOKEN: "token",
      }),
    ).toEqual(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);
  });

  test("counts an empty string as present", () => {
    expect(presentCredentialVars({ ...cleanEnv, ANTHROPIC_AUTH_TOKEN: "" })).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
  });
});

describe("buildSubprocessEnv", () => {
  test("inherits the parent env when there is nothing to change", () => {
    expect(buildSubprocessEnv({ baseEnv: cleanEnv, allowApiKey: false })).toBeUndefined();
    expect(
      buildSubprocessEnv({
        baseEnv: { ...cleanEnv, ANTHROPIC_API_KEY: "sk-test" },
        allowApiKey: true,
      }),
    ).toBeUndefined();
  });

  test("strips API credentials when the gate is off", () => {
    const env = expectDefined(
      buildSubprocessEnv({
        baseEnv: {
          ...cleanEnv,
          ANTHROPIC_API_KEY: "sk-test",
          ANTHROPIC_AUTH_TOKEN: "token",
        },
        allowApiKey: false,
      }),
    );
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(env.PATH).toBe("/usr/bin");
  });

  test("defaults to stripping when allowApiKey is omitted", () => {
    const env = expectDefined(
      buildSubprocessEnv({
        baseEnv: { ...cleanEnv, ANTHROPIC_API_KEY: "sk-test" },
      }),
    );
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
  });

  test("injects the temperature via CLAUDE_CODE_EXTRA_BODY", () => {
    const env = expectDefined(
      buildSubprocessEnv({
        baseEnv: cleanEnv,
        allowApiKey: false,
        temperature: 0.8,
      }),
    );
    expect(JSON.parse(expectDefined(env.CLAUDE_CODE_EXTRA_BODY))).toEqual({
      temperature: 0.8,
    });
  });

  test("merges the temperature over an existing extra body", () => {
    const env = expectDefined(
      buildSubprocessEnv({
        baseEnv: { ...cleanEnv, CLAUDE_CODE_EXTRA_BODY: '{"foo":1}' },
        allowApiKey: false,
        temperature: 0.5,
      }),
    );
    expect(JSON.parse(expectDefined(env.CLAUDE_CODE_EXTRA_BODY))).toEqual({
      foo: 1,
      temperature: 0.5,
    });
  });

  test("ignores a malformed existing extra body", () => {
    const env = expectDefined(
      buildSubprocessEnv({
        baseEnv: { ...cleanEnv, CLAUDE_CODE_EXTRA_BODY: "{oops" },
        allowApiKey: false,
        temperature: 0.5,
      }),
    );
    expect(JSON.parse(expectDefined(env.CLAUDE_CODE_EXTRA_BODY))).toEqual({
      temperature: 0.5,
    });
  });

  test("does not mutate the base environment", () => {
    const baseEnv = { ...cleanEnv, ANTHROPIC_API_KEY: "sk-test" };
    buildSubprocessEnv({ baseEnv, allowApiKey: false, temperature: 0.5 });
    expect(baseEnv.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(Object.keys(baseEnv)).not.toContain("CLAUDE_CODE_EXTRA_BODY");
  });
});

describe("buildQueryOptions", () => {
  const baseOpts = { model: "sonnet", system: "You write shell commands." };

  test("isolates the run from the user's Claude Code configuration", () => {
    const options = buildQueryOptions(baseOpts);
    // Every context source has its own switch; all of them must be off,
    // or the user's global MCP servers / skills / plugins leak into the
    // request and bloat (or overflow) every generation call.
    expect(options.tools).toEqual([]);
    expect(options.skills).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.plugins).toEqual([]);
    expect(options.settingSources).toEqual([]);
    expect(options.maxTurns).toBe(1);
  });

  test("passes the model and system prompt through", () => {
    const options = buildQueryOptions(baseOpts);
    expect(options.model).toBe("sonnet");
    expect(options.systemPrompt).toBe("You write shell commands.");
  });

  test("attaches the subprocess env only when one was built", () => {
    expect(buildQueryOptions(baseOpts).env).toBeUndefined();
    const subprocessEnv = { PATH: "/usr/bin" };
    expect(buildQueryOptions(baseOpts, subprocessEnv).env).toBe(subprocessEnv);
  });

  test("passes the structured output format through", () => {
    const outputFormat = {
      type: "json_schema" as const,
      schema: { type: "object" },
    };
    expect(buildQueryOptions(baseOpts).outputFormat).toBeUndefined();
    expect(buildQueryOptions({ ...baseOpts, outputFormat }).outputFormat).toBe(outputFormat);
  });
});
