/**
 * Prompt construction and response handling for command generation.
 *
 * The primary path is structured output against {@link COMMANDS_SCHEMA}, which
 * makes parsing robust regardless of how the model formats prose. The plain
 * text path exists only as a fallback for models that reject structured
 * output; it loses the explanation and the model's danger flag (the local
 * guard patterns still apply).
 */
import { shellName } from "./context.ts";
import type { GeneratedCommand } from "./types.ts";

/** Sentinel separating candidate commands in the plain-text fallback. */
export const OPTION_DELIMITER = "===OPTION===";

/**
 * JSON schema for the structured response: a list of command candidates, each
 * carrying its own explanation and danger self-assessment.
 */
export const COMMANDS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    commands: {
      type: "array",
      description: "The generated command candidate(s).",
      items: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "One single-line shell command that accomplishes the task.",
          },
          explanation: {
            type: "string",
            description: "One concise sentence describing what the command does.",
          },
          dangerous: {
            type: "boolean",
            description:
              "True when the command deletes or overwrites data, changes " +
              "system state, elevates privileges, writes to devices, kills " +
              "processes, rewrites published history, or pipes remote " +
              "content into a shell.",
          },
          dangerReason: {
            type: "string",
            description: "Why the command is dangerous (when it is).",
          },
        },
        required: ["command", "explanation", "dangerous"],
        additionalProperties: false,
      },
    },
  },
  required: ["commands"],
  additionalProperties: false,
};

/**
 * Normalise one command string, or reject it.
 *
 * Returns `null` for anything that is not exactly one clean line: embedded
 * control characters (`\r`, ESC sequences, tabs, C1 controls) can make the
 * rendered confirmation differ from what `sh -c` receives - a `\r` lets a
 * trailing `echo hello` visually overwrite the destructive first half - and
 * a multi-line command truncated to its first line would run something other
 * than what the model produced. Rejecting is safer than rewriting: a dropped
 * candidate falls through to the normal "no usable command" handling.
 */
export function normaliseCommand(text: string): string | null {
  const command = text.trim();
  if (command === "") return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting controls is the point
  if (/[\u0000-\u001f\u007f-\u009f]/.test(command)) return null;
  return command;
}

/**
 * Pull the candidate list out of a structured-output object. Entries without
 * a usable command (missing, empty, multi-line, or control-character-bearing)
 * are dropped; `null` when nothing usable remains.
 */
export function extractCandidates(structured: unknown): GeneratedCommand[] | null {
  if (
    structured === null ||
    typeof structured !== "object" ||
    !Array.isArray((structured as { commands?: unknown }).commands)
  ) {
    return null;
  }
  const entries = (structured as { commands: unknown[] }).commands;
  const candidates: GeneratedCommand[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.command !== "string") continue;
    const command = normaliseCommand(record.command);
    if (command === null) continue;
    candidates.push({
      command,
      explanation: typeof record.explanation === "string" ? record.explanation.trim() : "",
      dangerous: record.dangerous === true,
      modelAssessed: true,
      ...(typeof record.dangerReason === "string" && record.dangerReason.trim() !== ""
        ? { dangerReason: record.dangerReason.trim() }
        : {}),
    });
  }
  return candidates.length > 0 ? candidates : null;
}

export interface SystemPromptOptions {
  /** The shell the command targets (full path; the name is derived). */
  shellPath: string;
  /** Platform/shell context block, or `null` when context is disabled. */
  contextBlock: string | null;
  /** Extra instructions from the user's config or `-p` flag. */
  customPrompt: string | null;
  /** How many candidates will be requested (affects phrasing only). */
  count: number;
  /** Whether the response will be structured (JSON schema) or plain text. */
  structured: boolean;
}

/** System prompt for command generation. */
export function buildSystem(opts: SystemPromptOptions): string {
  const rules: string[] = [
    "You are an expert command-line engineer. The user describes a task; " +
      "you produce a single shell command that accomplishes it.",
    "The command must be one line. Pipes, `&&`, `;`, redirection and " +
      "subshells are fine; literal newlines are not.",
    "Do not perform the task yourself and do not ask questions - only write " + "the command.",
    "Prefer tools that exist on the target platform; mind BSD vs. GNU flag " +
      "differences, which are a notorious pitfall for same-named tools.",
  ];

  if (opts.contextBlock !== null) {
    rules.push(opts.contextBlock);
  } else {
    // Even with context injection disabled, the model must know which shell
    // will run the command - syntax differs across shells.
    rules.push(`Target shell: ${shellName(opts.shellPath)}.`);
  }

  if (opts.structured) {
    rules.push(
      "Assess whether the command is dangerous: anything that deletes or " +
        "overwrites data, changes system state or configuration, elevates " +
        "privileges, writes to raw devices, kills processes, rewrites " +
        'published history, or pipes remote content into a shell. Set the "dangerous" ' +
        'field accordingly and give a short "dangerReason" when it is true.',
      'The "explanation" field is one concise sentence in plain language.',
      'Each "command" field must contain the raw command text only - no ' +
        "markdown, no code fences, no surrounding quotes.",
    );
  } else {
    rules.push(
      "Output ONLY the command itself on a single line: no markdown, no " +
        "code fences, no quotes, no preamble, no explanation.",
    );
  }

  if (opts.customPrompt !== null && opts.customPrompt.trim() !== "") {
    rules.push(`Additional instructions from the user: ${opts.customPrompt}`);
  }

  return rules.join("\n");
}

/** User prompt for command generation. */
export function buildUser(task: string, count: number, structured: boolean): string {
  const header = `Task:\n\n${task}`;

  if (count <= 1) {
    return structured
      ? `${header}\n\nProduce one command for this task and return it as the only element of the "commands" array.`
      : header;
  }

  const distinct =
    `Produce exactly ${count} distinct command options - genuinely different ` +
    `approaches or tools where sensible. Each option must independently ` +
    `accomplish the whole task.`;

  if (structured) {
    return `${header}\n\n${distinct} Return them in the "commands" array.`;
  }
  return (
    `${header}\n\n${distinct} Output each option on its own line, preceded by ` +
    `a line containing exactly "${OPTION_DELIMITER}" and nothing else. ` +
    `Do not number the options or add any other text.`
  );
}

/** Strip stray formatting a model may add despite instructions. */
export function cleanCommand(text: string): string {
  let cmd = text.trim();

  // Prefer the contents of the first fenced code block, wherever it sits -
  // models sometimes wrap the command in prose ("Here's the command: ...").
  const fence = cmd.match(/```[^\n]*\n?([\s\S]*?)\n?```/);
  const fencedCommand = fence?.[1];
  if (fencedCommand !== undefined) cmd = fencedCommand.trim();

  // A command is one line; keep the first non-empty one.
  cmd =
    cmd
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  // Drop a copied-from-terminal prompt marker.
  if (cmd.startsWith("$ ")) cmd = cmd.slice(2).trim();

  // Remove matching wrapping quotes/backticks only if the whole command is wrapped.
  if (cmd.length >= 2) {
    const first = cmd.at(0);
    const last = cmd.at(-1);
    if (first !== undefined && first === last && (first === '"' || first === "'" || first === "`")) {
      const inner = cmd.slice(1, -1);
      if (!inner.includes(first)) cmd = inner.trim();
    }
  }

  return cmd;
}

/**
 * Turn a plain-text response into candidates. Explanation and the model's
 * danger flag are unavailable in this mode; the local guard patterns remain
 * the safety net.
 */
export function plainToCandidates(text: string, count: number): GeneratedCommand[] {
  const parts = count > 1 ? text.split(OPTION_DELIMITER) : [text];
  return parts
    .map(cleanCommand)
    .map((command) => normaliseCommand(command))
    .filter((command): command is string => command !== null)
    .map((command) => ({
      command,
      explanation: "",
      dangerous: false,
      modelAssessed: false,
    }));
}
