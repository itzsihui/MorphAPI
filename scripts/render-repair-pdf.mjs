/**
 * Render ApproachReport JSON → PDF for professors.
 * Usage:
 *   node scripts/render-repair-pdf.mjs baselines/mail_hybrid/out/repair-report.json
 *   node scripts/render-repair-pdf.mjs --mail
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MAIL_REPORTS = [
  "baselines/mail_ast/out/repair-report.json",
  "baselines/mail_llm_only/out/repair-report.json",
  "baselines/mail_hybrid/out/repair-report.json",
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function renderPdf(report, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const title = `Repair report — ${report.scenarioId} (${report.approach})`;
    doc.fontSize(16).font("Helvetica-Bold").text(title, { align: "left" });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(`Generated: ${report.generatedAt ?? ""}`);
    doc.fillColor("#000");
    doc.moveDown();

    const sum = report.summary ?? {};
    doc.fontSize(12).font("Helvetica-Bold").text("Impact summary (1°)");
    doc.fontSize(10).font("Helvetica");
    doc.text(
      `After primary fix: discovered ${sum.fixesDiscoveredAfterPrimary ?? 0} follow-up issue(s); completed ${sum.fixesCompletedAfterPrimary ?? 0}; remaining ${sum.fixesRemainingAfterPrimary ?? 0}`
    );
    doc.text(
      `Issues: ${sum.issueCount} (passed ${sum.issuesPassed}, failed ${sum.issuesFailed}) · cascade edges ${sum.cascadeEdges}`
    );
    doc.text(`All issues pass: ${sum.allIssuesPass}`);
    doc.text(`Narrative: ${sum.narrative ?? ""}`);
    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text("Repair process");
    doc.fontSize(10).font("Helvetica");
    for (const s of report.steps ?? []) {
      const disc = s.newlyDiscoveredIssueIds?.length
        ? ` → discovered ${s.newlyDiscoveredIssueIds.join(", ")}`
        : "";
      doc.text(
        `${s.step}. [${s.issueId}] ${s.action} (${s.source ?? "?"})${disc}`
      );
      if (s.notes) doc.text(`   ${s.notes}`, { indent: 12 });
    }
    doc.moveDown();

    if (report.impactFindings?.length) {
      doc.fontSize(12).font("Helvetica-Bold").text("Impact analysis (1°)");
      doc.fontSize(10).font("Helvetica");
      for (const f of report.impactFindings) {
        doc.text(
          `• ${f.id} from ${f.fromIssueId}: ${f.fileName}${f.startLine ? `:${f.startLine}` : ""} — ${f.reason}: ${f.detail}`
        );
      }
      doc.moveDown();
    }

    doc.fontSize(12).font("Helvetica-Bold").text("Issues & rubrics");
    doc.fontSize(9).font("Helvetica");
    for (const iss of report.issues ?? []) {
      const ev = (report.issueEvals ?? []).find((e) => e.issueId === iss.id);
      doc
        .font("Helvetica-Bold")
        .text(
          `${iss.id} — ${iss.kind} (${iss.discoveredAt})${ev ? ` · ${ev.pass ? "PASS" : "FAIL"}` : ""}`
        );
      doc.font("Helvetica");
      doc.text(
        `  ${iss.location?.fileName ?? "?"}${iss.location?.startLine ? `:${iss.location.startLine}` : ""} — ${iss.symptom}`
      );
      if (iss.causedByIssueId) {
        doc.text(`  Caused by: ${iss.causedByIssueId}`);
      }
      if (ev) {
        doc.text(
          `  Scores: compile=${ev.scores.compile} oracle=${ev.scores.oracle} semantic=${ev.scores.semantic} locality=${ev.scores.locality} cascade=${ev.scores.cascade}`
        );
      }
      doc.moveDown(0.4);
    }

    doc.end();
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}

async function processFile(jsonPath) {
  const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(ROOT, jsonPath);
  if (!fs.existsSync(abs)) {
    console.warn("skip missing", abs);
    return;
  }
  const report = JSON.parse(fs.readFileSync(abs, "utf8"));
  const base = path.basename(path.dirname(path.dirname(abs))); // mail_hybrid
  const outDir = path.join(ROOT, "docs", "repair", "pdf");
  ensureDir(outDir);
  const outPath = path.join(outDir, `${base}.pdf`);
  await renderPdf(report, outPath);
  console.log("Wrote", outPath);
}

const arg = process.argv[2];
if (arg === "--mail") {
  for (const p of MAIL_REPORTS) await processFile(p);
} else if (arg) {
  await processFile(arg);
} else {
  console.error(
    "Usage: node scripts/render-repair-pdf.mjs <repair-report.json> | --mail"
  );
  process.exit(1);
}
