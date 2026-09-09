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
export { generateCode, stripCodeFences, readUtf8, writeUtf8 } from "./llm";
export type { LlmMessage, LlmGenerateOptions } from "./llm";
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
