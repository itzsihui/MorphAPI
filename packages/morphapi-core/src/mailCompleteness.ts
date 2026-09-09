import { findSendEmailSpans } from "./astScan";

export interface MailSiteFinding {
  fileName: string;
  startLine: number;
  text: string;
  kind: "leftover_sendEmail" | "migrated_send";
}

export interface MailCompletenessResult {
  ok: boolean;
  leftoverCount: number;
  migratedCount: number;
  expectedSites: number;
  sites: MailSiteFinding[];
}

function findMigratedSendCalls(
  fileName: string,
  code: string
): MailSiteFinding[] {
  const findings: MailSiteFinding[] = [];
  // Rough but stable: call to send( with object literal (not sendEmail)
  const re = /(?<![\w.])send\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const before = code.slice(0, m.index);
    const startLine = before.split(/\n/).length;
    const snippet = code.slice(m.index, Math.min(code.length, m.index + 80));
    findings.push({
      fileName,
      startLine,
      text: snippet.replace(/\s+/g, " ").trim(),
      kind: "migrated_send",
    });
  }
  return findings;
}

/**
 * Completeness gate for Scenario 7: no leftover sendEmail(...); prefer send({...}).
 */
export function assertMailMigrationComplete(
  files: Record<string, string>,
  expectedSites = 4
): MailCompletenessResult {
  const sites: MailSiteFinding[] = [];

  for (const [fileName, code] of Object.entries(files)) {
    for (const span of findSendEmailSpans(fileName, code)) {
      sites.push({
        fileName,
        startLine: span.startLine,
        text: span.text.replace(/\s+/g, " ").trim().slice(0, 100),
        kind: "leftover_sendEmail",
      });
    }
    sites.push(...findMigratedSendCalls(fileName, code));
  }

  const leftoverCount = sites.filter((s) => s.kind === "leftover_sendEmail")
    .length;
  const migratedCount = sites.filter((s) => s.kind === "migrated_send").length;

  return {
    ok: leftoverCount === 0 && migratedCount >= expectedSites,
    leftoverCount,
    migratedCount,
    expectedSites,
    sites,
  };
}

/** Pull positional args from sendEmail(a, b, c, d) for oracle fallback. */
export function extractSendEmailArgs(spanText: string): {
  to: string;
  from: string;
  subject: string;
  body: string;
} {
  const inner = spanText
    .replace(/^sendEmail\s*\(/, "")
    .replace(/\)\s*$/, "")
    .trim();
  // Split top-level commas (ignore commas inside template/strings/parens)
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    const prev = inner[i - 1];
    if (quote) {
      cur += ch;
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());

  return {
    to: parts[0] ?? '""',
    from: parts[1] ?? '""',
    subject: parts[2] ?? '""',
    body: parts[3] ?? '""',
  };
}

export function oracleMailReplacementForSpan(spanText: string): string {
  const { to, from, subject, body } = extractSendEmailArgs(spanText);
  return `send({
    to: ${to},
    from: ${from},
    subject: ${subject},
    content: ${body},
  })`;
}
