/**
 * The command-generation pipeline: one isolated model call with a
 * structured-first attempt ladder.
 *
 * Attempts, in order (whichever succeeds first wins):
 *
 * 1. Structured output with a temperature bump - only when several candidates
 *    are requested and `interactiveTemperature` is set, for variety.
 * 2. Structured output without the temperature (for models that reject a
 *    temperature override).
 * 3. Plain text with delimiter parsing and cleanup (for models that don't
 *    support structured output at all). This path loses the explanation and
 *    the model's danger flag; the local guard patterns still apply.
 */
import { runPrompt } from "./agent.ts";
import { resolveShell } from "./context.ts";
import { AicmdError } from "./errors.ts";
import { buildSystem, buildUser, COMMANDS_SCHEMA, extractCandidates, plainToCandidates } from "./prompts.ts";
import type { Config, GeneratedCommand } from "./types.ts";

export interface GenerateProgress {
  /** Called when a new phase of work begins (for spinner labels). */
  onPhase?: (label: string) => void;
}

export interface GenerateOptions {
  /** Number of candidate commands to produce (interactive mode uses > 1). */
  count?: number;
  /** Platform/shell context block for the prompt, `null` to omit. */
  contextBlock?: string | null;
  /** Shell the command targets. Defaults to the resolved config shell. */
  shellPath?: string;
  progress?: GenerateProgress;
  abortController?: AbortController;
  /** Receives the SDK subprocess's stderr (wired by `--verbose`). */
  onStderr?: (data: string) => void;
  /**
   * Model runner used for every prompt; injectable so tests can exercise the
   * attempt ladder without real model calls. Defaults to {@link runPrompt}.
   */
  runner?: typeof runPrompt;
}

export interface GenerateResult {
  /** Candidate commands (length 1 outside interactive mode). */
  candidates: GeneratedCommand[];
  /** Total cost across all attempts, in USD. */
  costUsd: number;
  /** The model that served the successful attempt, if reported. */
  model?: string;
}

/** Generate command candidate(s) for a natural-language task. */
export async function generateCommands(
  task: string,
  config: Config,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const {
    count = 1,
    contextBlock = null,
    shellPath = resolveShell(config.shell),
    progress = {},
    abortController,
    onStderr,
    runner = runPrompt,
  } = options;

  progress.onPhase?.(count > 1 ? `Generating ${count} command options` : "Generating command");

  const baseOpts = {
    model: config.model,
    allowApiKey: config.allowApiKey,
    ...(abortController ? { abortController } : {}),
    ...(onStderr ? { onStderr } : {}),
  };
  const temperature = count > 1 && config.interactiveTemperature != null ? config.interactiveTemperature : undefined;

  const attempts: Array<{ structured: boolean; temperature?: number }> = [];
  if (temperature != null) attempts.push({ structured: true, temperature });
  attempts.push({ structured: true });
  attempts.push({ structured: false });

  let candidates: GeneratedCommand[] | null = null;
  let costUsd = 0;
  let model: string | undefined;
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const result = await runner(buildUser(task, count, attempt.structured), {
        ...baseOpts,
        system: buildSystem({
          shellPath,
          contextBlock,
          customPrompt: config.customPrompt,
          count,
          structured: attempt.structured,
        }),
        ...(attempt.structured
          ? {
              outputFormat: {
                type: "json_schema" as const,
                schema: COMMANDS_SCHEMA,
              },
            }
          : {}),
        ...(attempt.temperature != null ? { temperature: attempt.temperature } : {}),
      });
      costUsd += result.costUsd;
      if (result.model !== undefined) model = result.model;
      candidates = attempt.structured ? extractCandidates(result.structured) : plainToCandidates(result.text, count);
      if (candidates && candidates.length > 0) break;
    } catch (err) {
      lastError = err;
      // If the run was cancelled, stop retrying: the shared abort signal
      // would make every remaining attempt fail immediately in the same way.
      if (abortController?.signal.aborted) break;
    }
  }

  const deduped = dedupeByCommand(candidates ?? []);
  if (deduped.length === 0) {
    if (lastError instanceof AicmdError) throw lastError;
    throw new AicmdError("The model did not produce a command.");
  }

  return {
    candidates: deduped,
    costUsd,
    ...(model !== undefined ? { model } : {}),
  };
}

function dedupeByCommand(candidates: GeneratedCommand[]): GeneratedCommand[] {
  const seen = new Set<string>();
  const out: GeneratedCommand[] = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate.command)) {
      seen.add(candidate.command);
      out.push(candidate);
    }
  }
  return out;
}
