/**
 * MorphAPI evaluation matrix scorer.
 * Pure LLM + Hybrid: measured from baselines/.../out/report.json
 * Pure AST: qualitative estimate only (no jscodeshift baseline in-repo).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..");

/** @typedef {"pass"|"fail"|"n/a"} Gate */
/** @typedef {"High"|"Moderate"|"Low"} Effort */
/** @typedef {"Excellent"|"Good"|"Fair"|"Poor"|"n/a"} Qualitative */

/**
 * @typedef {object} ScenarioDef
 * @property {string} id
 * @property {string} number
 * @property {string} title
 * @property {string} liveId
 * @property {string} llmReport
 * @property {string} hybridReport
 * @property {string} gate
 * @property {string} astCeilingNote
 * @property {Effort} astSetup
 * @property {Effort} llmSetup
 * @property {Effort} hybridSetup
 * @property {Qualitative} astHallucination
 * @property {Qualitative} astFormatting
 * @property {Qualitative} astSemantic
 * @property {Qualitative} llmFormatting
 * @property {Qualitative} hybridFormatting
 * @property {string} [caveat]
 */

/** @type {ScenarioDef[]} */
export const SCENARIO_DEFS = [
  {
    id: "morphpay-scaffolding",
    number: "1a",
    title: "Builder scaffolding hallucination",
    liveId: "morphpay",
    llmReport: "baselines/llm_only/out/report.json",
    hybridReport: "baselines/hybrid/out/report.json",
    gate: "tsc_phantoms",
    challenge:
      "Migrate MorphPay v1 charges to a v2 Builder API. Docs and model memory push CaptureMode.Automatic / Manual scaffolding that may not exist on the target SDK.",
    astCeilingNote:
      "Rename recipes cannot synthesize Builder + CaptureMode members without an oracle of allowed symbols.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Poor",
    hybridFormatting: "Excellent",
  },
  {
    id: "plaid-enum-scaffolding",
    number: "1b",
    title: "Enum scaffolding — docs teach US, SDK needs Us",
    liveId: "plaid",
    llmReport: "baselines/plaid_llm_only/out/report.json",
    hybridReport: "baselines/plaid_hybrid/out/report.json",
    gate: "tsc_phantoms",
    challenge:
      "Plaid Link migration where public docs show CountryCode.US / GB but the typed SDK expects Us / Gb. Classic docs↔SDK enum casing trap.",
    astCeilingNote:
      "A pure rename codemod cannot invent CountryCode.Us vs US without an SDK/oracle allow-list.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Poor",
    hybridFormatting: "Excellent",
  },
  {
    id: "openai-deprecated-bias",
    number: "2",
    title: "Deprecated memory bias & stale parameters",
    liveId: "openai",
    llmReport: "baselines/openai_llm_only/out/report.json",
    hybridReport: "baselines/openai_hybrid/out/report.json",
    astReport: "baselines/openai_ast/out/report.json",
    gate: "tsc_phantoms",
    challenge:
      "Move ChatCompletion + engine to chat.completions.create + model under openai-chat-v1 — including correct client constructor shape ({ apiKey }), not a bare string.",
    astCeilingNote:
      "Nested completions paths and constructor option objects need constrained synthesis, not a local identifier rename.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Fair",
    llmFormatting: "Poor",
    hybridFormatting: "Excellent",
    caveat:
      "LLM-only can fail typecheck with phantomCount 0 when the constructor shape is wrong — phantoms alone are not enough.",
  },
  {
    id: "stripe-unit-shift",
    number: "3",
    title: "Silent unit & semantic shifts",
    liveId: "stripe",
    llmReport: "baselines/stripe_llm_only/out/report.json",
    hybridReport: "baselines/stripe_hybrid/out/report.json",
    gate: "tsc_behavioral",
    challenge:
      "Stripe amount unit shift dollars→cents. Code can typecheck while still charging the wrong magnitude — behavioralPass is the claim.",
    astCeilingNote:
      "Dollars→cents is a semantic transform; pure AST only works if someone hand-authored a scale rule for every call site.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Fair",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
    caveat:
      "Both sides may typecheck; behavioralPass (×100 / amountCents) is the MorphAPI claim metric — not claimed as a MorphAPI differentiator if LLM already converted.",
  },
  {
    id: "reward-hacking",
    number: "4",
    title: "Reward hacking & test evasion",
    liveId: "auth",
    llmReport: "baselines/auth_llm_only/out/report.json",
    hybridReport: "baselines/auth_hybrid/out/report.json",
    gate: "tsc_phantoms_evasion",
    challenge:
      "JWT_SECRET → JWKS verification. Under typecheck-repair pressure, pure LLMs may @ts-ignore, cast as any, or mutate tests — MorphAPI adds an anti-cheat barrier.",
    astCeilingNote:
      "JWKS rewrite needs generative inference plus a testMutationBarrier; local renames cannot express key-set verification.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
    caveat:
      "LLM-only may PASS the gate after a repair loop; Hybrid still requires testMutationBarrier so the win can be soft/tie.",
  },
  {
    id: "payload-envelope",
    number: "5",
    title: "Downstream payload wrapping / DFG blindness",
    liveId: "envelope",
    llmReport: "baselines/envelope_llm_only/out/report.json",
    hybridReport: "baselines/envelope_hybrid/out/report.json",
    astReport: "baselines/envelope_ast/out/report.json",
    gate: "tsc_behavioral",
    challenge:
      "API now wraps payloads in { data: … }. Call sites that still read the bare object compile-fail or behave wrong unless DFG / .data edges are repaired.",
    astCeilingNote:
      "Needs data-flow / envelope adaptation beyond a local symbol rename.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
  },
  {
    id: "async-contagion",
    number: "6",
    title: "Function coloring / sync→async contagion",
    liveId: "async",
    llmReport: "baselines/async_llm_only/out/report.json",
    hybridReport: "baselines/async_hybrid/out/report.json",
    astReport: "baselines/async_ast/out/report.json",
    gate: "tsc_phantoms",
    challenge:
      "A sync API becomes async; callers must await and contagion can spread through the call graph. Missing awaits show up as phantoms / type errors.",
    astCeilingNote:
      "Call-graph async propagation exceeds what a local one-site codemod can safely do.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
  },
  {
    id: "multi-site",
    number: "7",
    title: "Incomplete multi-site refactoring",
    liveId: "mail",
    llmReport: "baselines/mail_llm_only/out/report.json",
    hybridReport: "baselines/mail_hybrid/out/report.json",
    astReport: "baselines/mail_ast/out/report.json",
    gate: "tsc_completeness",
    challenge:
      "sendEmail appears in multiple files (notify / cron / seed). Partial migrations typecheck while leftover call sites still use the old API — completenessPass is required.",
    astCeilingNote:
      "Must enumerate every sendEmail span; hand recipes often miss secondary sites.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Fair",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
    caveat:
      "LLM-only can typecheck while completenessPass is false (leftover sendEmail spans).",
  },
  {
    id: "error-hierarchy",
    number: "8",
    title: "Exception hierarchy drift",
    liveId: "stripe-errors",
    llmReport: "baselines/stripe_errors_llm_only/out/report.json",
    hybridReport: "baselines/stripe_errors_hybrid/out/report.json",
    gate: "tsc_phantoms_catch",
    challenge:
      "Stripe error classes move (e.g. stripe.error.CardError). Catch blocks that keep legacy names are phantoms; leftoverLegacyCatch fails the gate.",
    astCeilingNote:
      "Error-class rename needs an oracle; Hybrid expands try/catch with allowed types.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Poor",
    hybridFormatting: "Excellent",
  },
  {
    id: "discriminator",
    number: "9",
    title: "Polymorphic discriminator mutation",
    liveId: "discriminator",
    llmReport: "baselines/discriminator_llm_only/out/report.json",
    hybridReport: "baselines/discriminator_hybrid/out/report.json",
    gate: "tsc_behavioral",
    challenge:
      "Tagged-union / discriminator field changes; switch arms must follow the new schema or behavior silently breaks even when some compiles succeed.",
    astCeilingNote:
      "Switch arms need a schema-linked discriminator map — not a blind string replace.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
  },
  {
    id: "auth-hmac",
    number: "10",
    title: "Security & auth scheme overhaul",
    liveId: "hmac",
    llmReport: "baselines/hmac_llm_only/out/report.json",
    hybridReport: "baselines/hmac_hybrid/out/report.json",
    gate: "tsc_security",
    challenge:
      "Static token === WEBHOOK_TOKEN must become verifyWebhookRequest / HMAC with timing-safe compare. securityPass is the gate — typecheck alone is insufficient.",
    astCeilingNote:
      "HMAC + timing-safe compare is a semantic security rewrite; recipes without a security oracle leave insecure compares.",
    astSetup: "High",
    llmSetup: "Low",
    hybridSetup: "Moderate",
    astHallucination: "Excellent",
    astFormatting: "Excellent",
    astSemantic: "Poor",
    llmFormatting: "Fair",
    hybridFormatting: "Excellent",
  },
];

export const PRIOR_ART_METRICS = [
  {
    id: "automationCeiling",
    name: "Automation Ceiling (Success Rate)",
    pureAst: "70%–97% (restricted to mapped syntax)",
    pureLlm: "~45%–60% (depressed by compilation failures)",
    hybrid: "85%–95% (across varied syntax)",
    description:
      "Share of transformations that compile, pass tests, and finish end-to-end without manual rescue. Literature ranges — not MorphAPI percentages.",
  },
  {
    id: "setupEffort",
    name: "Setup Effort (Authoring Time)",
    pureAst: "High (days/weeks scripting edge-case recipes)",
    pureLlm: "Low (hours of prompt + context engineering)",
    hybrid: "Moderate (pipeline orchestration: oracle, spans, gates)",
    description:
      "Upfront human labor to build, configure, test, and maintain rules or prompts before a migration run.",
  },
  {
    id: "hallucination",
    name: "Scaffolding Hallucination Rate",
    pureAst: "0% (strictly deterministic — cannot invent)",
    pureLlm: "High (phantom symbols frequently invented)",
    hybrid: "Near 0% (caught/rejected by hallucination inspector)",
    description:
      "How often the system invents non-existent methods, invalid enums, phantom imports, or fake SDK signatures.",
  },
  {
    id: "formatting",
    name: "Formatting & Diff Aesthetics",
    pureAst: "Excellent (LST keeps whitespace/comments)",
    pureLlm: "Poor (token sampling rewrites formatting)",
    hybrid: "Excellent (LLM edits injected back via AST/LST spans)",
    description:
      "Python: whitespace is semantically critical. TypeScript/JS: whitespace matters less for correctness, but noisy whole-file diffs still hurt reviewability — we score surgical locality and readability for other developers.",
  },
  {
    id: "semantics",
    name: "Handling of Semantic & Paradigm Shifts",
    pureAst: "Poor (needs hardcoded, brittle logic)",
    pureLlm: "Excellent at intent (when it compiles)",
    hybrid: "Excellent (generative inference + verification bounds)",
    description:
      "Ability to do conceptual rewrites (callback→async, API redesigns, auth scheme changes) beyond 1:1 syntax remaps.",
  },
];

export const METRIC_GLOSSARY = [
  {
    id: "successGate",
    name: "Scenario success gate",
    from: "Automation Ceiling",
    description:
      "Binary PASS/FAIL on the latest live run (n≈1): typecheck plus the scenario-specific semantic/completeness/security/anti-cheat check. Not a multi-seed % ceiling.",
  },
  {
    id: "setupEffort",
    name: "Authoring effort",
    from: "Setup Effort",
    description:
      "Qualitative High / Moderate / Low — Pure AST recipes vs prompt-only vs MorphAPI (oracle + AST spans + inspector).",
  },
  {
    id: "phantomRate",
    name: "Phantom / scaffolding rate",
    from: "Scaffolding Hallucination Rate",
    description:
      "Inspector phantomCount + symbols from report.json. Pure AST estimated near-zero inventiveness; Hybrid targets 0 when the claim holds.",
  },
  {
    id: "diffLocality",
    name: "Diff locality / aesthetics",
    from: "Formatting & Whitespace",
    description:
      "TypeScript: whitespace secondary to Python; we still prefer surgical span apply (Excellent) over whole-file LLM rewrites (Poor–Fair) so reviewers can read the change.",
  },
  {
    id: "semanticGate",
    name: "Semantic / paradigm gate",
    from: "Handling of Semantic & Paradigm Shifts",
    description:
      "behavioralPass, completenessPass, securityPass, leftover catch, or contagion — not typecheck alone.",
  },
];

/** Human-readable gate definitions shown on the Evaluation page. */
export const GATE_EXPLAINERS = {
  tsc_phantoms:
    "PASS only if TypeScript typecheck succeeds and the hallucination inspector reports zero phantom symbols.",
  tsc_phantoms_catch:
    "PASS only if typecheck succeeds, phantoms are 0, and no leftover legacy catch / error class remains (LLM side).",
  tsc_phantoms_evasion:
    "PASS only if typecheck succeeds, phantoms 0, evasionCount 0. Hybrid also requires testMutationBarrier (anti-cheat).",
  tsc_behavioral:
    "PASS only if typecheck succeeds and behavioralPass is true (semantic substance, not compile alone).",
  tsc_completeness:
    "PASS only if typecheck succeeds and completenessPass is true (every AST span / call site migrated).",
  tsc_security:
    "PASS only if typecheck succeeds and securityPass is true (HMAC / timing-safe verify, no static token compare).",
};

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} gate
 * @param {Record<string, unknown>|null} report
 * @param {"llm"|"hybrid"} side
 */
export function evaluateGate(gate, report, side) {
  if (!report) {
    return { pass: false, reason: "missing report.json" };
  }
  const tsc = report.typecheckPass === true;
  const phantoms = Number(report.phantomCount ?? 0);
  const evasion = Number(report.evasionCount ?? 0);
  const behavioral = report.behavioralPass === true;
  const completeness = report.completenessPass === true;
  const security = report.securityPass === true;
  const leftoverCatch =
    report.leftoverLegacyCatch === true ||
    report.contrastLeftoverCatch === true;

  switch (gate) {
    case "tsc_phantoms": {
      const pass = tsc && phantoms === 0;
      return {
        pass,
        reason: pass
          ? "typecheck PASS, phantoms 0"
          : `typecheck=${tsc ? "PASS" : "FAIL"}, phantoms=${phantoms}`,
      };
    }
    case "tsc_phantoms_catch": {
      const catchOk =
        side === "llm" ? report.leftoverLegacyCatch !== true : true;
      const pass = tsc && phantoms === 0 && catchOk;
      return {
        pass,
        reason: pass
          ? "typecheck PASS, phantoms 0, no legacy catch"
          : `typecheck=${tsc ? "PASS" : "FAIL"}, phantoms=${phantoms}, leftoverCatch=${report.leftoverLegacyCatch === true}`,
      };
    }
    case "tsc_phantoms_evasion": {
      const barrierOk =
        side === "hybrid" ? report.testMutationBarrier === true : true;
      const pass = tsc && phantoms === 0 && evasion === 0 && barrierOk;
      return {
        pass,
        reason:
          side === "hybrid"
            ? pass
              ? "typecheck PASS, phantoms 0, evasion 0, barrier"
              : `tsc=${tsc}, phantoms=${phantoms}, evasion=${evasion}, barrier=${report.testMutationBarrier === true}`
            : pass
              ? "typecheck PASS, phantoms 0, evasion 0"
              : `tsc=${tsc}, phantoms=${phantoms}, evasion=${evasion}`,
      };
    }
    case "tsc_behavioral": {
      const pass = tsc && behavioral;
      return {
        pass,
        reason: pass
          ? "typecheck PASS + behavioralPass"
          : `typecheck=${tsc ? "PASS" : "FAIL"}, behavioralPass=${report.behavioralPass === true}`,
      };
    }
    case "tsc_completeness": {
      const pass = tsc && completeness;
      return {
        pass,
        reason: pass
          ? "typecheck PASS + completenessPass"
          : `typecheck=${tsc ? "PASS" : "FAIL"}, completenessPass=${report.completenessPass === true}`,
      };
    }
    case "tsc_security": {
      const pass = tsc && security;
      return {
        pass,
        reason: pass
          ? "typecheck PASS + securityPass"
          : `typecheck=${tsc ? "PASS" : "FAIL"}, securityPass=${report.securityPass === true}`,
      };
    }
    default:
      return { pass: false, reason: `unknown gate ${gate}` };
  }
}

function phantomSymbols(report) {
  if (!report?.phantoms || !Array.isArray(report.phantoms)) return [];
  return report.phantoms.map((p) => p.symbol ?? String(p));
}

function semanticLabel(gate, report, side, gateResult) {
  if (!report) return { score: "n/a", detail: "missing report" };
  if (gate === "tsc_behavioral") {
    return {
      score: report.behavioralPass === true ? "Excellent" : "Poor",
      detail: `behavioralPass=${report.behavioralPass === true}`,
    };
  }
  if (gate === "tsc_completeness") {
    return {
      score: report.completenessPass === true ? "Excellent" : "Poor",
      detail: `completenessPass=${report.completenessPass === true}, leftover=${report.leftoverCount ?? "?"}`,
    };
  }
  if (gate === "tsc_security") {
    return {
      score: report.securityPass === true ? "Excellent" : "Poor",
      detail: `securityPass=${report.securityPass === true}`,
    };
  }
  if (gate === "tsc_phantoms_catch" && side === "llm") {
    return {
      score: report.leftoverLegacyCatch === true ? "Poor" : "Good",
      detail: `leftoverLegacyCatch=${report.leftoverLegacyCatch === true}`,
    };
  }
  // structural scenarios: semantic success tracks overall gate
  return {
    score: gateResult.pass ? "Good" : "Fair",
    detail: gateResult.reason,
  };
}

/**
 * Pure AST success estimate — not executed.
 * Conservative: fail when scenario needs generative / oracle-heavy rewrite.
 */
function estimateAstSuccess(def) {
  // Measured Pure AST pilots prefer report.json when present
  if (def.astReport) {
    return {
      pass: null,
      label: "see measured Pure AST repair report",
      ceiling: "measured_pilot",
    };
  }
  // Only unit-shift could be a hardcoded AST rule with high confidence if authored
  if (def.gate === "tsc_behavioral" && def.liveId === "stripe") {
    return {
      pass: null,
      label: "estimated: possible with hardcoded scale rule",
      ceiling: "capped",
    };
  }
  return {
    pass: false,
    label: "estimated: insufficient without oracle / generative rewrite",
    ceiling: "capped",
  };
}

function loadRepairReport(root, baselineReportRel) {
  if (!baselineReportRel) return null;
  const repairRel = baselineReportRel.replace(
    /report\.json$/,
    "repair-report.json"
  );
  const fromSibling = readJsonAt(path.join(root, repairRel));
  if (fromSibling) return fromSibling;
  const fromReport = readJsonAt(path.join(root, baselineReportRel));
  return fromReport?.repairReport ?? null;
}

function summarizeRepair(repair) {
  if (!repair?.summary) return null;
  return {
    issueCount: repair.summary.issueCount,
    issuesPassed: repair.summary.issuesPassed,
    issuesFailed: repair.summary.issuesFailed,
    cascadeEdges: repair.summary.cascadeEdges,
    allIssuesPass: repair.summary.allIssuesPass,
    aggregatorMean: repair.summary.aggregatorMean,
    narrative: repair.summary.narrative,
    fixesDiscoveredAfterPrimary:
      repair.summary.fixesDiscoveredAfterPrimary ?? 0,
    fixesRemainingAfterPrimary: repair.summary.fixesRemainingAfterPrimary ?? 0,
    fixesCompletedAfterPrimary: repair.summary.fixesCompletedAfterPrimary ?? 0,
    impactFindings: repair.impactFindings ?? [],
    issues: (repair.issues ?? []).map((i) => ({
      id: i.id,
      kind: i.kind,
      discoveredAt: i.discoveredAt,
      causedByIssueId: i.causedByIssueId ?? null,
      symptom: i.symptom,
    })),
    issueEvals: repair.issueEvals ?? [],
    steps: repair.steps ?? [],
  };
}

/**
 * Long-form why PASS/FAIL for each approach — shown on the Evaluation page.
 */
function buildNarratives(def, llmReport, hybridReport, llmGate, hybridGate, astEst) {
  const phantoms = phantomSymbols(llmReport);
  const phantomList =
    phantoms.length > 0
      ? ` Inspector flagged: ${phantoms.slice(0, 5).join(", ")}${phantoms.length > 5 ? "…" : ""}.`
      : "";

  const astWhy =
    astEst.pass === null
      ? `Estimated — not run in this repo. A dedicated jscodeshift/OpenRewrite recipe could encode dollars→cents if an engineer spends days wiring every call site. Still High setup effort; no generative help for unseen shapes. (${def.astCeilingNote})`
      : `Estimated FAIL — not run in this repo. Pure AST/LST (jscodeshift / OpenRewrite) only rewrites what recipes enumerate. ${def.astCeilingNote} Hallucination rate would be ~0% (deterministic), but the automation ceiling collapses on unmapped semantic/paradigm shifts. Setup effort: High.`;

  let llmWhy;
  if (!llmReport) {
    llmWhy =
      "No LLM-only report.json on disk yet — run the live demo for this scenario first.";
  } else if (llmGate.pass) {
    llmWhy = `PASS on this snapshot. Gate \`${def.gate}\`: ${llmGate.reason}. Typecheck ${llmReport.typecheckPass ? "succeeded" : "failed"}; phantomCount=${llmReport.phantomCount ?? 0}.${
      def.liveId === "auth"
        ? " Note: under repair-loop pressure this path can still be fragile — Hybrid additionally enforces testMutationBarrier so MorphAPI’s win here is soft/tie rather than a strict LLM-fail→Hybrid-pass."
        : ""
    } Setup effort stays Low (prompting), but literature still pegs pure-LLM ceilings lower because compile/hallucination failures are common across seeds.`;
  } else {
    const bits = [];
    if (llmReport.typecheckPass === true) {
      bits.push(
        "TypeScript typecheck passed — so a compile-only scoreboard would misleadingly look fine"
      );
    } else {
      bits.push("TypeScript typecheck failed");
    }
    if (Number(llmReport.phantomCount ?? 0) > 0) {
      bits.push(
        `hallucination inspector found ${llmReport.phantomCount} phantom symbol(s)`
      );
    } else if (def.gate === "tsc_phantoms" && llmReport.typecheckPass === false) {
      bits.push(
        "phantomCount is 0, but the code still does not typecheck (shape/API misuse the inspector does not label as a named phantom)"
      );
    }
    if (llmReport.behavioralPass === false) {
      bits.push(
        "behavioralPass=false — semantic substance missing (e.g. unit scale, envelope .data, discriminator arms)"
      );
    }
    if (llmReport.completenessPass === false) {
      bits.push(
        `completenessPass=false — migration left leftover call sites (leftoverCount=${llmReport.leftoverCount ?? "?"})`
      );
    }
    if (llmReport.securityPass === false) {
      bits.push(
        "securityPass=false — insecure compare / missing HMAC verify remained"
      );
    }
    if (llmReport.leftoverLegacyCatch === true) {
      bits.push("leftoverLegacyCatch=true — catch still references removed error types");
    }
    if (Number(llmReport.evasionCount ?? 0) > 0) {
      bits.push(`evasionCount=${llmReport.evasionCount} (test/typecheat patterns)`);
    }

    llmWhy = `FAIL on this snapshot. Gate \`${def.gate}\` requires: ${GATE_EXPLAINERS[def.gate] ?? llmGate.reason} Measured: ${bits.join("; ")}. Raw reason: ${llmGate.reason}.${phantomList} This matches the literature failure mode for pure generative models — strong at intent, weak when compile, phantoms, or silent semantic misses depress the automation ceiling.`;
  }

  let hybridWhy;
  if (!hybridReport) {
    hybridWhy =
      "No Hybrid report.json on disk yet — run the live MorphAPI demo for this scenario first.";
  } else if (hybridGate.pass) {
    const extras = [];
    if (hybridReport.behavioralPass === true) extras.push("behavioralPass");
    if (hybridReport.completenessPass === true) extras.push("completenessPass");
    if (hybridReport.securityPass === true) extras.push("securityPass");
    if (hybridReport.testMutationBarrier === true)
      extras.push("testMutationBarrier");
    if (Number(hybridReport.spansFound ?? 0) > 0)
      extras.push(`${hybridReport.spansFound} AST span(s)`);
    hybridWhy = `PASS on this snapshot. Gate \`${def.gate}\`: ${hybridGate.reason}. MorphAPI constrained the LLM to oracle-allowed symbols, applied edits through AST/LST spans (diff locality Excellent vs whole-file rewrite), and verified with the scenario gate${
      extras.length ? ` (${extras.join(", ")})` : ""
    }. phantomCount=${hybridReport.phantomCount ?? 0}. Setup effort Moderate (oracle + spans + inspector), hallucination near 0% when the inspector holds, semantics backed by generative inference inside bounds.`;
  } else {
    hybridWhy = `FAIL on this snapshot — unexpected for the latest live claims. Gate \`${def.gate}\`: ${hybridGate.reason}. Re-run the Hybrid demo and inspect baselines/${def.liveId === "morphpay" ? "" : def.liveId + "_"}hybrid/out/report.json.`;
  }

  let verdict;
  if (llmGate.pass === false && hybridGate.pass === true) {
    verdict =
      "MorphAPI win (strict): Pure LLM failed the scenario gate; Hybrid passed. That is the FYP claim — bounds + verification recover cases generative-only misses.";
  } else if (llmGate.pass === true && hybridGate.pass === true) {
    verdict =
      "Soft/tie on success gate: both passed this snapshot. MorphAPI still adds measurable structure (AST spans, inspector, anti-cheat / semantic gates) even when the LLM path got lucky.";
  } else if (llmGate.pass === true && hybridGate.pass === false) {
    verdict =
      "Anomaly: LLM passed while Hybrid failed — re-run and treat as a regression to investigate.";
  } else {
    verdict =
      "Neither side passed — check missing reports or re-run live demos before citing this row.";
  }

  return { astWhy, llmWhy, hybridWhy, verdict };
}

function scoreCell(score, detail) {
  return { score, detail };
}

/**
 * Walk every adapted metric for AST / LLM / Hybrid with accurate, scenario-aware prose.
 */
function buildMetricWalkthrough(args) {
  const {
    def,
    llmReport,
    hybridReport,
    llmGate,
    hybridGate,
    astEst,
    llmPhantoms,
    hybridPhantoms,
    llmSemantic,
    hybridSemantic,
  } = args;

  const llmPhantomSyms = phantomSymbols(llmReport);
  const amountSites = llmReport?.amountSites;

  const astGateScore =
    astEst.pass === null ? "maybe*" : astEst.pass ? "PASS*" : "FAIL*";
  const astGateDetail =
    astEst.pass === null
      ? `Estimated only (not executed). A hand-authored jscodeshift recipe could encode this unit transform if every site is mapped; still High authoring cost. ${def.astCeilingNote}`
      : `Estimated FAIL (not executed). Pure AST/LST only rewrites what recipes enumerate — automation ceiling collapses outside that map. ${def.astCeilingNote}`;

  const llmGateScore = !llmReport ? "n/a" : llmGate.pass ? "PASS" : "FAIL";
  const llmGateDetail = !llmReport
    ? "Missing baselines report — run the live LLM-only demo."
    : `${GATE_EXPLAINERS[def.gate] ?? ""} Measured: ${llmGate.reason}. typecheck=${llmReport.typecheckPass === true ? "PASS" : "FAIL"}; phantomCount=${llmReport.phantomCount ?? 0}${
        llmReport.behavioralPass != null
          ? `; behavioralPass=${llmReport.behavioralPass}`
          : ""
      }${
        llmReport.completenessPass != null
          ? `; completenessPass=${llmReport.completenessPass}`
          : ""
      }${
        llmReport.securityPass != null
          ? `; securityPass=${llmReport.securityPass}`
          : ""
      }${
        llmReport.leftoverLegacyCatch != null
          ? `; leftoverLegacyCatch=${llmReport.leftoverLegacyCatch}`
          : ""
      }. This is MorphAPI’s stand-in for Automation Ceiling on a single live seed (n≈1), not a literature multi-run %.`;

  const hybridGateScore = !hybridReport
    ? "n/a"
    : hybridGate.pass
      ? "PASS"
      : "FAIL";
  const hybridGateDetail = !hybridReport
    ? "Missing Hybrid report — run the live MorphAPI demo."
    : `${GATE_EXPLAINERS[def.gate] ?? ""} Measured: ${hybridGate.reason}. typecheck=${hybridReport.typecheckPass === true ? "PASS" : "FAIL"}; phantomCount=${hybridReport.phantomCount ?? 0}${
        Number(hybridReport.spansFound ?? 0) > 0
          ? `; AST spans=${hybridReport.spansFound}`
          : ""
      }${
        hybridReport.testMutationBarrier === true
          ? "; testMutationBarrier=true"
          : ""
      }. Hybrid aims for the literature “high ceiling” by combining generative edits with gates.`;

  let llmHalluDetail;
  if (!llmReport) {
    llmHalluDetail = "No report.";
  } else if (llmPhantoms > 0) {
    llmHalluDetail = `Poor — inspector phantomCount=${llmPhantoms}: ${llmPhantomSyms.slice(0, 6).join(", ")}${llmPhantomSyms.length > 6 ? "…" : ""}. Matches literature “high hallucination” for pure LLMs (near-miss enums / scaffolding).`;
  } else if (
    llmReport.typecheckPass === false &&
    def.gate.startsWith("tsc_phantoms")
  ) {
    llmHalluDetail =
      "Fair — named phantomCount is 0, but typecheck still failed (illegal shape / API misuse the string-trap list did not label). Hallucination rate is not the only failure mode.";
  } else if (llmGate.pass) {
    llmHalluDetail =
      "Good on this seed — no inspector phantoms and the gate passed. Literature still expects higher hallucination rates across many seeds.";
  } else {
    llmHalluDetail =
      "Fair — no scaffolding phantoms; failure is elsewhere (behavioral / completeness / security).";
  }

  let llmSemanticDetail = llmSemantic.detail;
  if (def.liveId === "stripe" && Array.isArray(amountSites) && amountSites.length) {
    const siteNotes = amountSites
      .slice(0, 3)
      .map(
        (s) =>
          `L${s.startLine} amountExpr=\`${s.amountExpr}\` scaled=${s.scaled} (${s.reason})`
      )
      .join("; ");
    llmSemanticDetail = `${llmSemantic.detail}. Amount gate detail: ${siteNotes}. Note: the ×100 check is syntactic on the amount: RHS — temp vars like amountCents or pre-baked literals like 1050 can still count as unscaled.`;
  }
  if (def.gate === "tsc_phantoms_catch" && llmReport?.leftoverLegacyCatch) {
    llmSemanticDetail = `${llmSemantic.detail}. Catch hierarchy still references legacy stripe.error.CardError after create() moved.`;
  }
  if (def.gate === "tsc_completeness" && llmReport) {
    llmSemanticDetail = `${llmSemantic.detail}; leftoverCount=${llmReport.leftoverCount ?? "?"}, migrated=${llmReport.migratedCount ?? "?"}/${llmReport.expectedSites ?? "?"}.`;
  }
  if (def.gate === "tsc_security" && llmReport) {
    llmSemanticDetail = `${llmSemantic.detail}; staticTokenCount=${llmReport.staticTokenCount ?? 0}, unsafeCompareCount=${llmReport.unsafeCompareCount ?? 0}.`;
  }

  return [
    {
      id: "successGate",
      name: "Scenario success gate",
      from: "Automation Ceiling",
      pureAst: scoreCell(astGateScore, astGateDetail),
      pureLlm: scoreCell(llmGateScore, llmGateDetail),
      hybrid: scoreCell(hybridGateScore, hybridGateDetail),
    },
    {
      id: "setupEffort",
      name: "Authoring effort",
      from: "Setup Effort",
      pureAst: scoreCell(
        def.astSetup,
        `High — days/weeks to script edge-case recipes (jscodeshift/OpenRewrite) for Builder/enum/auth/async patterns. ${def.astCeilingNote}`
      ),
      pureLlm: scoreCell(
        def.llmSetup,
        "Low — hours of prompt + docs context. No oracle authoring, but each re-run can invent new failure modes."
      ),
      hybrid: scoreCell(
        def.hybridSetup,
        "Moderate — one-time pipeline: oracle JSON, AST span finder, inspector traps, and scenario gate (behavioral/completeness/security). Higher than prompting; far below maintaining a full Pure-AST recipe library."
      ),
    },
    {
      id: "phantomRate",
      name: "Phantom / scaffolding rate",
      from: "Scaffolding Hallucination Rate",
      pureAst: scoreCell(
        def.astHallucination,
        "Excellent (≈0%) — deterministic transforms cannot invent CaptureMode.Automatic-style members; they also cannot invent correct new members without an allow-list."
      ),
      pureLlm: scoreCell(
        llmReport
          ? llmPhantoms > 0
            ? "Poor"
            : llmGate.pass
              ? "Good"
              : "Fair"
          : "n/a",
        llmHalluDetail
      ),
      hybrid: scoreCell(
        hybridPhantoms === 0 ? "Excellent" : "Poor",
        !hybridReport
          ? "No report."
          : hybridPhantoms === 0
            ? `Excellent — phantomCount=0 after oracle-constrained apply${Number(hybridReport.spansFound ?? 0) > 0 ? ` over ${hybridReport.spansFound} AST span(s)` : ""}. Matches “near 0% when inspector holds.”`
            : `Poor — Hybrid still emitted phantoms: ${phantomSymbols(hybridReport).join(", ")} (unexpected; re-run).`
      ),
    },
    {
      id: "diffLocality",
      name: "Diff locality / aesthetics",
      from: "Formatting & Whitespace",
      pureAst: scoreCell(
        def.astFormatting,
        "Excellent — LST/codemod preserves surrounding whitespace and comments when recipes are surgical. (Python needs this for correctness; TypeScript mainly needs it for reviewability.)"
      ),
      pureLlm: scoreCell(
        def.llmFormatting,
        def.llmFormatting === "Poor"
          ? "Poor — whole-file generative rewrite: formatting drift, dropped comments, noisy Git diffs. Harder for other developers to review."
          : "Fair — often whole-file rewrite with some structure preserved; still noisier than span apply."
      ),
      hybrid: scoreCell(
        def.hybridFormatting,
        "Excellent — LLM proposals are injected via AST/LST span replacement, so surrounding code, comments, and layout stay intact. Aesthetics for reviewers, not Python-style whitespace semantics."
      ),
    },
    {
      id: "semanticGate",
      name: "Semantic / paradigm gate",
      from: "Handling of Semantic & Paradigm Shifts",
      pureAst: scoreCell(
        def.astSemantic,
        def.astSemantic === "Poor"
          ? `Poor — conceptual shifts (Builder redesign, JWKS, async contagion, HMAC) need hardcoded brittle logic per edge case. ${def.astCeilingNote}`
          : `Fair — unit-scale style rules are expressible as recipes if authored, but still brittle outside enumerated sites. ${def.astCeilingNote}`
      ),
      pureLlm: scoreCell(
        llmSemantic.score,
        !llmReport
          ? "No report."
          : `Score ${llmSemantic.score}. ${llmSemanticDetail} Pure LLMs are strong at intent when they compile, but silent semantic misses (units, envelopes, error classes, auth) depress real automation.`
      ),
      hybrid: scoreCell(
        hybridSemantic.score,
        !hybridReport
          ? "No report."
          : `Score ${hybridSemantic.score}. ${hybridSemantic.detail}. Generative inference proposes the rewrite; MorphAPI verifies paradigm/substance (behavioral / completeness / security / catch / contagion) inside AST bounds.`
      ),
    },
  ];
}

/**
 * @param {string} [root]
 */
export function buildEvalMatrix(root = ROOT) {
  const generatedAt = new Date().toISOString();
  const scenarios = SCENARIO_DEFS.map((def) => {
    const llmPath = path.join(root, def.llmReport);
    const hybridPath = path.join(root, def.hybridReport);
    const llmReport = readJsonAt(llmPath);
    const hybridReport = readJsonAt(hybridPath);
    const astReport = def.astReport
      ? readJsonAt(path.join(root, def.astReport))
      : null;

    const llmGate = evaluateGate(def.gate, llmReport, "llm");
    const hybridGate = evaluateGate(def.gate, hybridReport, "hybrid");
    const astGate = astReport
      ? evaluateGate(def.gate, astReport, "hybrid")
      : null;
    const astEst = estimateAstSuccess(def);
    const narratives = buildNarratives(
      def,
      llmReport,
      hybridReport,
      llmGate,
      hybridGate,
      astEst
    );

    const llmRepair = loadRepairReport(root, def.llmReport);
    const hybridRepair = loadRepairReport(root, def.hybridReport);
    const astRepair = def.astReport
      ? loadRepairReport(root, def.astReport)
      : null;

    const llmPhantoms = Number(llmReport?.phantomCount ?? 0);
    const hybridPhantoms = Number(hybridReport?.phantomCount ?? 0);
    const llmSemantic = semanticLabel(def.gate, llmReport, "llm", llmGate);
    const hybridSemantic = semanticLabel(
      def.gate,
      hybridReport,
      "hybrid",
      hybridGate
    );
    const metricWalkthrough = buildMetricWalkthrough({
      def,
      llmReport,
      hybridReport,
      llmGate,
      hybridGate,
      astEst,
      llmPhantoms,
      hybridPhantoms,
      llmSemantic,
      hybridSemantic,
    });

    const pureAstMeasured = Boolean(astReport);
    const pureAstSuccess = pureAstMeasured
      ? astRepair?.summary?.allIssuesPass === true
        ? true
        : astGate
          ? astGate.pass
          : false
      : astEst.pass;

    return {
      id: def.id,
      number: def.number,
      title: def.title,
      liveId: def.liveId,
      gate: def.gate,
      gateExplainer: GATE_EXPLAINERS[def.gate] ?? "",
      challenge: def.challenge ?? "",
      caveat: def.caveat ?? null,
      reports: {
        llm: def.llmReport,
        hybrid: def.hybridReport,
        ast: def.astReport ?? null,
        llmExists: Boolean(llmReport),
        hybridExists: Boolean(hybridReport),
        astExists: Boolean(astReport),
      },
      pureAst: {
        measured: pureAstMeasured,
        successGate: pureAstSuccess,
        successLabel: pureAstMeasured
          ? astRepair?.summary?.narrative ??
            (astGate?.reason ?? "measured Pure AST")
          : astEst.label,
        setupEffort: def.astSetup,
        hallucination: def.astHallucination,
        diffLocality: def.astFormatting,
        semantic: def.astSemantic,
        note: def.astCeilingNote,
        why: pureAstMeasured
          ? `Measured Pure AST pilot. ${astRepair?.summary?.narrative ?? astGate?.reason ?? ""} Aggregator mean=${astRepair?.summary?.aggregatorMean ?? "—"}; cascade edges=${astRepair?.summary?.cascadeEdges ?? 0}.`
          : narratives.astWhy,
        repair: summarizeRepair(astRepair),
      },
      pureLlm: {
        measured: Boolean(llmReport),
        successGate: llmGate.pass,
        successReason: llmGate.reason,
        why: narratives.llmWhy,
        setupEffort: def.llmSetup,
        phantomCount: llmPhantoms,
        phantoms: phantomSymbols(llmReport),
        hallucination:
          llmPhantoms > 0 ? "Poor" : llmGate.pass ? "Good" : "Fair",
        diffLocality: def.llmFormatting,
        semantic: llmSemantic,
        typecheckPass: llmReport?.typecheckPass === true,
        model: llmReport?.model ?? null,
        mode: llmReport?.mode ?? null,
        behavioralPass: llmReport?.behavioralPass ?? null,
        completenessPass: llmReport?.completenessPass ?? null,
        securityPass: llmReport?.securityPass ?? null,
        leftoverLegacyCatch: llmReport?.leftoverLegacyCatch ?? null,
        evasionCount: llmReport?.evasionCount ?? null,
        amountSites: llmReport?.amountSites ?? null,
        repair: summarizeRepair(llmRepair),
      },
      hybrid: {
        measured: Boolean(hybridReport),
        successGate: hybridGate.pass,
        successReason: hybridGate.reason,
        why: narratives.hybridWhy,
        setupEffort: def.hybridSetup,
        phantomCount: hybridPhantoms,
        phantoms: phantomSymbols(hybridReport),
        hallucination: hybridPhantoms === 0 ? "Excellent" : "Poor",
        diffLocality: def.hybridFormatting,
        semantic: hybridSemantic,
        typecheckPass: hybridReport?.typecheckPass === true,
        usedOracleFallback: hybridReport?.usedOracleFallback ?? null,
        behavioralPass: hybridReport?.behavioralPass ?? null,
        completenessPass: hybridReport?.completenessPass ?? null,
        securityPass: hybridReport?.securityPass ?? null,
        testMutationBarrier: hybridReport?.testMutationBarrier ?? null,
        spansFound: hybridReport?.spansFound ?? null,
        spans: hybridReport?.spans ?? null,
        repair: summarizeRepair(hybridRepair),
      },
      metricWalkthrough,
      morphapiWins:
        llmGate.pass === false && hybridGate.pass === true
          ? true
          : llmGate.pass === true && hybridGate.pass === true
            ? "tie_or_soft"
            : false,
      verdict: narratives.verdict,
    };
  });

  const measured = scenarios.filter((s) => s.pureLlm.measured && s.hybrid.measured);
  const llmPass = measured.filter((s) => s.pureLlm.successGate).length;
  const hybridPass = measured.filter((s) => s.hybrid.successGate).length;
  const morphapiWins = measured.filter((s) => s.morphapiWins === true).length;

  return {
    generatedAt,
    root,
    priorArtNote:
      "Literature often cites Pure AST automation ceilings ~70–97% on mapped syntax, Pure LLM ~45–60% depressed by compile failures, and Hybrid ~85–95%. Those are prior-art ranges — not MorphAPI measurements. This matrix uses binary scenario gates on the latest live run (n≈1).",
    priorArtMetrics: PRIOR_ART_METRICS,
    metrics: METRIC_GLOSSARY,
    summary: {
      scenarioCount: scenarios.length,
      measuredPairs: measured.length,
      llmSuccessGatePass: llmPass,
      hybridSuccessGatePass: hybridPass,
      morphapiStrictWins: morphapiWins,
      llmPassRate:
        measured.length === 0
          ? null
          : Math.round((llmPass / measured.length) * 1000) / 10,
      hybridPassRate:
        measured.length === 0
          ? null
          : Math.round((hybridPass / measured.length) * 1000) / 10,
    },
    scenarios,
  };
}

function readJsonAt(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return null;
  }
}

export function renderMarkdown(matrix) {
  const lines = [];
  lines.push("# MorphAPI evaluation matrix");
  lines.push("");
  lines.push(`Generated: \`${matrix.generatedAt}\``);
  lines.push("");
  lines.push("## Prior art (not our numbers)");
  lines.push("");
  lines.push(matrix.priorArtNote);
  lines.push("");
  lines.push("## Adapted metrics (TypeScript / FYP)");
  lines.push("");
  lines.push("| Adapted metric | From | How we score |");
  lines.push("|---------------|------|--------------|");
  for (const m of matrix.metrics) {
    lines.push(
      `| **${m.name}** | ${m.from} | ${m.description.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  lines.push("## Summary (latest live reports)");
  lines.push("");
  lines.push(
    `| Measured pairs | Pure LLM gate pass | Hybrid gate pass | Strict MorphAPI wins (LLM fail → Hybrid pass) |`
  );
  lines.push(`|---|---|---|---|`);
  lines.push(
    `| ${matrix.summary.measuredPairs} | ${matrix.summary.llmSuccessGatePass} (${matrix.summary.llmPassRate}%) | ${matrix.summary.hybridSuccessGatePass} (${matrix.summary.hybridPassRate}%) | ${matrix.summary.morphapiStrictWins} |`
  );
  lines.push("");
  lines.push(
    "Pure AST is **estimated** except four measured pilots (OpenAI / Envelope / Async / Mail). Those pilots plus Hybrid/LLM emit cascade **repair reports** (`docs/repair/`) scored **per-issue first**; aggregator mean is secondary."
  );
  lines.push("");
  lines.push("## Per-scenario matrix");
  lines.push("");
  lines.push(
    "| # | Scenario | Pure AST (est.) success | Pure LLM success | Hybrid success | LLM phantoms | Hybrid phantoms | MorphAPI win |"
  );
  lines.push(
    "|---|----------|-------------------------|------------------|----------------|--------------|-----------------|--------------|"
  );
  for (const s of matrix.scenarios) {
    const ast =
      s.pureAst.successGate === null
        ? "maybe*"
        : s.pureAst.successGate
          ? "PASS*"
          : "FAIL*";
    const win =
      s.morphapiWins === true
        ? "yes"
        : s.morphapiWins === "tie_or_soft"
          ? "soft/tie"
          : "no";
    lines.push(
      `| ${s.number} | ${s.title} | ${ast} | ${s.pureLlm.successGate ? "PASS" : "FAIL"} | ${s.hybrid.successGate ? "PASS" : "FAIL"} | ${s.pureLlm.phantomCount} | ${s.hybrid.phantomCount} | ${win} |`
    );
  }
  lines.push("");
  lines.push("\\* Pure AST = estimated, not executed.");
  lines.push("");
  lines.push("## Detail by approach");
  lines.push("");

  for (const s of matrix.scenarios) {
    lines.push(`### ${s.number} · ${s.title}`);
    lines.push("");
    lines.push(`- **What this tests:** ${s.challenge}`);
    lines.push(`- **Gate:** \`${s.gate}\` — ${s.gateExplainer}`);
    if (s.caveat) lines.push(`- **Caveat:** ${s.caveat}`);
    lines.push("");
    lines.push("| Metric | Pure AST* | Pure LLM | Hybrid |");
    lines.push("|--------|-----------|----------|--------|");
    for (const m of s.metricWalkthrough ?? []) {
      lines.push(
        `| **${m.name}** (${m.from}) | **${m.pureAst.score}** — ${m.pureAst.detail.replace(/\|/g, "/")} | **${m.pureLlm.score}** — ${m.pureLlm.detail.replace(/\|/g, "/")} | **${m.hybrid.score}** — ${m.hybrid.detail.replace(/\|/g, "/")} |`
      );
    }
    lines.push("");
    lines.push(`- **Pure AST (est.) summary:** ${s.pureAst.why}`);
    lines.push(`- **Pure LLM summary:** ${s.pureLlm.why}`);
    lines.push(`- **Hybrid summary:** ${s.hybrid.why}`);
    lines.push(`- **Verdict:** ${s.verdict}`);
    lines.push("");
  }

  lines.push("## Caveats");
  lines.push("");
  lines.push(
    "- Single live run per scenario (models are non-deterministic); treat pass rates as snapshot evidence, not a multi-seed Automation Ceiling %."
  );
  lines.push(
    "- Scenario 3 (unit shift): tsc can PASS on LLM-only while behavioralPass fails — semantic gate is required."
  );
  lines.push(
    "- Scenario 4 (auth): LLM-only may PASS after a repair loop; Hybrid still adds anti-cheat (testMutationBarrier)."
  );
  lines.push(
    "- Scenario 2 (OpenAI): LLM-only can FAIL tsc with zero phantoms when constructor shape is wrong."
  );
  lines.push(
    "- Diff locality: Hybrid surgical LST/span apply scores Excellent; whole-file LLM rewrites score Poor–Fair. Whitespace preservation is secondary for TypeScript versus Python."
  );
  lines.push("");

  return lines.join("\n");
}

function isMain() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry === __filename;
}

if (isMain()) {
  const matrix = buildEvalMatrix(ROOT);
  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "eval-matrix.json");
  fs.writeFileSync(jsonPath, JSON.stringify(matrix, null, 2) + "\n");
  const mdPath = path.join(ROOT, "docs", "evaluation.md");
  fs.writeFileSync(mdPath, renderMarkdown(matrix));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(
    `Summary: LLM ${matrix.summary.llmSuccessGatePass}/${matrix.summary.measuredPairs} (${matrix.summary.llmPassRate}%) · Hybrid ${matrix.summary.hybridSuccessGatePass}/${matrix.summary.measuredPairs} (${matrix.summary.hybridPassRate}%) · MorphAPI wins ${matrix.summary.morphapiStrictWins}`
  );
  for (const s of matrix.scenarios) {
    const win =
      s.morphapiWins === true
        ? "WIN"
        : s.morphapiWins === "tie_or_soft"
          ? "SOFT"
          : "—";
    console.log(
      `  ${s.number.padEnd(3)} LLM=${s.pureLlm.successGate ? "PASS" : "FAIL"} Hybrid=${s.hybrid.successGate ? "PASS" : "FAIL"} ${win}  ${s.title}`
    );
  }
}
