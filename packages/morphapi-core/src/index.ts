export type { ApiOracle, PhantomFinding, InspectResult } from "./inspector";
export {
  loadOracle,
  inspectCode,
  classifyPhantom,
  detectEvasionTactics,
} from "./inspector";
export type { UsageSpan } from "./astScan";
export {
  findChargesCreateSpans,
  findLinkTokenCreateSpans,
  findChatCompletionCreateSpans,
  findJwtVerifySpans,
  findListUsersAwaitSpans,
  findGetObjectPromiseSpans,
  findChargesCreateTrySpans,
  findSendEmailSpans,
  findEventSwitchSpans,
  findStaticTokenCompareSpans,
  findAuthorizeLegacyCompatSpans,
  parseSourceFile,
} from "./astScan";
export { applySpanReplacement } from "./apply";
export { runTypecheck } from "./typecheck";
export { extractSymbolsFromCode } from "./symbols";
export { generateCode, resolveModelProfile, stripCodeFences, readUtf8, writeUtf8 } from "./llm";
export type { LlmMessage, LlmGenerateOptions, ModelProfile } from "./llm";
export { loadEnv } from "./env";
export type { AmountSiteFinding, AmountTransformResult } from "./amountTransform";
export {
  assertAmountTransform,
  extractAmountExprFromSpanText,
} from "./amountTransform";
export type {
  EnvelopeSiteFinding,
  EnvelopeTransformResult,
} from "./envelopeTransform";
export {
  assertEnvelopeUnwrap,
  oracleEnvelopeReplacementForSpan,
} from "./envelopeTransform";
export type { AsyncContagionFinding } from "./asyncContagion";
export {
  findAsyncContagionIssues,
  assertAsyncContagion,
  oracleAsyncStorageMigration,
} from "./asyncContagion";
export type {
  MailSiteFinding,
  MailCompletenessResult,
} from "./mailCompleteness";
export {
  assertMailMigrationComplete,
  extractSendEmailArgs,
  oracleMailReplacementForSpan,
} from "./mailCompleteness";
export type {
  DiscriminatorMapping,
  DiscriminatorSiteFinding,
  DiscriminatorTransformResult,
} from "./discriminatorTransform";
export {
  assertDiscriminatorMigration,
  loadDiscriminatorMapping,
  oracleDiscriminatorSwitchReplacement,
  rewriteDiscriminatorLiterals,
} from "./discriminatorTransform";
export type {
  HmacSecurityFinding,
  HmacSecurityResult,
} from "./hmacSecurity";
export {
  assertHmacSecurity,
  oracleAuthorizeLegacyCompatReplacement,
} from "./hmacSecurity";

export type {
  ApproachKind,
  ApproachReport,
  Citation,
  ImpactFinding,
  IssueDiscoveredAt,
  IssueEval,
  IssueKind,
  IssueLocation,
  IssueSeverity,
  RepairIssue,
  RepairStep,
  RubricDimension,
  RubricScore,
  RubricScores,
} from "./repairReport";
export {
  RUBRIC_GLOSSARY,
  buildApproachReport,
  cascadeImpactCounts,
  emptyRubric,
  meanRubric,
  nextIssueId,
  resetIssueSeq,
  scoreIssuePass,
  spanToLocation,
  usageSpansToReportSpans,
  writeRepairReportJson,
} from "./repairReport";
export {
  detectNewlyAsyncExports,
  findDirectCallers,
  findOneHopImpact,
  impactToIssues,
} from "./impactGraph";
export type { ImpactProbe, SourceFileInput } from "./impactGraph";
export {
  DepsNotInstalledError,
  ProjectSession,
  findDeprecatedReferences,
  findNearestTsconfig,
  findReferences,
  loadProgram,
  packageNameOf,
  resolveAlias,
  resolveModuleFile,
  resolveSymbolSpec,
} from "./program";
export type {
  DeprecatedCallSpan,
  LoadedProgram,
  SessionDiagnostic,
  SymbolReference,
} from "./program";
export { buildCodePropertyGraph } from "./codePropertyGraph";
export {
  buildSlicePrompt,
  needsStatementSlice,
  parsesAs,
  sliceFactsFor,
  sliceFor,
} from "./sliceMetadata";
export type { Slice, SliceKind, SlicePromptInput, SuccessorKind } from "./sliceMetadata";
export { addMissingImports, reconcileImports, removeUnusedImports } from "./importReconcile";
export type { ImportCandidate, ImportEdits } from "./importReconcile";
export { extractOracle, importCandidates, suggestSymbols } from "./oracleExtract";
export type { ExtractedOracle, OracleExport } from "./oracleExtract";
export { feedbackFor, gateSpan, repairLoop } from "./gate";
export type { AttemptRecord, GateFinding, GateFindingKind, GateResult } from "./gate";
export { propagateResponseShape } from "./dataflow";
export type { ShapeResult, ShapeRewrite } from "./dataflow";
export { diagnosticKeys, programImpact, snapshotSignatures } from "./impactProgram";
export type { ProgramImpactFinding, ProgramImpactReason, ProgramImpactResult } from "./impactProgram";
export { ARMS, runMigration } from "./pipeline";
export type { ArmConfig, ArmId, ImpactFix, MigrationConfig, MigrationEvent, MigrationRun, SpanStep } from "./pipeline";
export type {
  AstOutlineNode,
  BuildCpgInput,
  CallArgFact,
  CodePropertyGraph,
  CpgEdge,
  CpgEdgeKind,
  CpgNode,
  CpgNodeKind,
  DataFlowRole,
  DeprecatedReason,
  FocusDfgNode,
  SliceFacts,
} from "./codePropertyGraph";
