/**
 * Shared types for aicmd.
 */

/** Fully-resolved configuration after merging defaults, file config and CLI flags. */
export interface Config {
  /** Model used to generate commands (alias like `sonnet` or a full model id). */
  model: string;
  /**
   * Shell the command is generated for and executed with. `null` resolves at
   * run time to `$SHELL`, falling back to `/bin/sh`.
   */
  shell: string | null;
  /**
   * Default to interactive mode (the `-i` selection TUI) on every run, without
   * needing to pass `-i`. Override for a single run with `--no-interactive`.
   * When there is no interactive terminal this is ignored and aicmd falls back
   * to the plain flow rather than failing.
   */
  interactive: boolean;
  /** How many candidate commands to generate in interactive mode. */
  interactiveCount: number;
  /**
   * Sampling temperature for the model when generating interactive options,
   * to encourage variety between candidates. `null` leaves the model at its
   * default. Only applied when more than one candidate is requested.
   */
  interactiveTemperature: number | null;
  /**
   * Name of the progress spinner animation: any spinner from the cli-spinners
   * set bundled with ora (e.g. `"dots"`, `"moon"`, `"material"`). Unknown
   * names are ignored and the default is used instead.
   */
  spinner: string;
  /** Extra instructions appended to the generation system prompt. */
  customPrompt: string | null;
  /**
   * Include a platform/shell context block (OS, BSD-vs-GNU userland, target
   * shell) in the prompt so the generated command fits this machine.
   */
  includeContext: boolean;
  /** Show the model's one-line explanation beneath the generated command. */
  showExplanation: boolean;
  /**
   * Guard patterns matched against generated commands. Plain strings are
   * fish-style whole-string globs (`*` matches anything); the `re:` prefix
   * switches the remainder to a regular expression. `null` uses the built-in
   * defaults; setting an array replaces them.
   */
  dangerousPatterns: string[] | null;
  /** Additional guard patterns appended to whichever base list is active. */
  extraDangerousPatterns: string[];
  /**
   * Allow API credentials from the environment (`ANTHROPIC_API_KEY` /
   * `ANTHROPIC_AUTH_TOKEN`) to be used, billing pay-as-you-go instead of the
   * Claude subscription. When false (the default) those variables are
   * stripped from the environment passed to the Claude Agent SDK subprocess,
   * so an exported key can never silently switch billing.
   */
  allowApiKey: boolean;
}

/** Partial config as it may appear in a config file or be produced by flags. */
export type PartialConfig = {
  [K in keyof Config]?: Config[K];
};

/** One generated command candidate, as returned by the model. */
export interface GeneratedCommand {
  /** The single-line shell command. */
  command: string;
  /** One concise sentence describing what the command does. */
  explanation: string;
  /** The model's own danger assessment. */
  dangerous: boolean;
  /** Why the model considers the command dangerous, when it does. */
  dangerReason?: string;
  /**
   * Whether {@link dangerous} is a real model assessment (structured output)
   * rather than a default. The plain-text fallback cannot carry the model's
   * verdict, and downstream safety routing must be able to tell the
   * difference - a defaulted `false` is not a clean bill of health.
   */
  modelAssessed?: boolean;
}

/** The combined local + model danger verdict for one candidate. */
export interface DangerAssessment {
  dangerous: boolean;
  /** Human-readable reasons (guard-pattern hits and/or the model's reason). */
  reasons: string[];
  /**
   * True when the model's own danger self-assessment backed this verdict.
   * When false, only the local guard patterns were applied, and `--execute`
   * refuses to run without `--force`.
   */
  modelSignalAvailable: boolean;
}

/** Result of a single model invocation. */
export interface ModelResult {
  /** The text the model produced. */
  text: string;
  /** Cost of the call in USD, if reported. */
  costUsd: number;
  /** The model that actually served the request, if reported. */
  model?: string;
  /** Parsed structured output, when a JSON-schema `outputFormat` was requested. */
  structured?: unknown;
}
