/**
 * Library entry point: the building blocks of the aicmd CLI, re-exported for
 * programmatic use.
 */
export {
  VERSION,
  buildProgram,
  decideAction,
  flagsToConfig,
  printCommandBlock,
  printDangerWarning,
  resolveRunMode,
  run,
  runCommand,
  taskFromArgs,
  type CliOptions,
  type PlainAction,
  type RunMode,
} from "./src/cli.ts";
export {
  generateCommands,
  type GenerateOptions,
  type GenerateProgress,
  type GenerateResult,
} from "./src/generate.ts";
export {
  GATED_CREDENTIAL_VARS,
  buildQueryOptions,
  buildSubprocessEnv,
  presentCredentialVars,
  runPrompt,
  type RunPromptOptions,
  type SubprocessEnvOptions,
} from "./src/agent.ts";
export {
  COMMANDS_SCHEMA,
  OPTION_DELIMITER,
  buildSystem,
  buildUser,
  cleanCommand,
  extractCandidates,
  normaliseCommand,
  plainToCandidates,
  type SystemPromptOptions,
} from "./src/prompts.ts";
export {
  DEFAULT_DANGEROUS_PATTERNS,
  assessDanger,
  compilePattern,
  effectivePatterns,
  matchDangerousPattern,
} from "./src/safety.ts";
export {
  DEFAULT_CONFIG,
  globalConfigDir,
  loadFileConfig,
  mergeConfig,
  mergePartial,
  resolveConfig,
  sanitizePartial,
  type LoadFileConfigOptions,
} from "./src/config.ts";
export {
  buildContextBlock,
  gatherContext,
  resolveShell,
  shellName,
  type ContextInfo,
} from "./src/context.ts";
export { executeCommand, signalExitCode } from "./src/exec.ts";
export { AicmdError } from "./src/errors.ts";
export type {
  Config,
  DangerAssessment,
  GeneratedCommand,
  ModelResult,
  PartialConfig,
} from "./src/types.ts";
