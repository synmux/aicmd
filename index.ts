/**
 * Library entry point: the building blocks of the aicmd CLI, re-exported for
 * programmatic use.
 */

export {
  buildQueryOptions,
  buildSubprocessEnv,
  GATED_CREDENTIAL_VARS,
  presentCredentialVars,
  type RunPromptOptions,
  runPrompt,
  type SubprocessEnvOptions,
} from "./src/agent.ts";
export {
  buildProgram,
  type CliOptions,
  decideAction,
  flagsToConfig,
  type PlainAction,
  type RunMode,
  resolveRunMode,
  run,
  runCommand,
  taskFromArgs,
  VERSION,
} from "./src/cli.ts";
export {
  DEFAULT_CONFIG,
  globalConfigDir,
  type LoadFileConfigOptions,
  loadFileConfig,
  mergeConfig,
  mergePartial,
  resolveConfig,
  sanitizePartial,
} from "./src/config.ts";
export { buildContextBlock, type ContextInfo, gatherContext, resolveShell, shellName } from "./src/context.ts";
export { AicmdError } from "./src/errors.ts";
export { executeCommand, signalExitCode } from "./src/exec.ts";
export { type GenerateOptions, type GenerateProgress, type GenerateResult, generateCommands } from "./src/generate.ts";
export {
  buildSystem,
  buildUser,
  COMMANDS_SCHEMA,
  cleanCommand,
  extractCandidates,
  normaliseCommand,
  OPTION_DELIMITER,
  plainToCandidates,
  type SystemPromptOptions,
} from "./src/prompts.ts";
export {
  assessDanger,
  compilePattern,
  DEFAULT_DANGEROUS_PATTERNS,
  effectivePatterns,
  matchDangerousPattern,
} from "./src/safety.ts";
export type { Config, DangerAssessment, GeneratedCommand, ModelResult, PartialConfig } from "./src/types.ts";
export {
  printCancelled,
  printCommandBlock,
  printDangerWarning,
  printIntro,
  printMuted,
  printRefusal,
  printRunAnnouncement,
  printWarning,
} from "./src/ui/chrome.ts";
