import { useCallback, useEffect, useState } from "react";
import { ContextBriefing } from "./ContextBriefing";
import { Landing } from "./Landing";
import { LiveDemo } from "./LiveDemo";
import { ScenarioCaseView } from "./ScenarioCase";
import {
  SCENARIOS,
  getScenario,
  type LiveScenarioId,
} from "./scenarios/catalog";
import type { Scenario } from "./api";

type PrimaryNav = "landing" | "taxonomy" | "live" | "context";

function parseHash(): {
  primary: PrimaryNav;
  scenarioId: string;
  liveId: LiveScenarioId;
} {
  const raw = window.location.hash.replace(/^#/, "") || "landing";
  const [primaryRaw, rest] = raw.split("/");
  const primary = (
    ["landing", "taxonomy", "live", "context"] as const
  ).includes(primaryRaw as PrimaryNav)
    ? (primaryRaw as PrimaryNav)
    : "landing";

  if (primary === "taxonomy") {
    const id = rest || SCENARIOS[0]?.id || "morphpay-scaffolding";
    return {
      primary,
      scenarioId: getScenario(id) ? id : SCENARIOS[0].id,
      liveId: "plaid",
    };
  }
  if (primary === "live") {
    const liveId: LiveScenarioId =
      rest === "morphpay" ||
      rest === "plaid" ||
      rest === "openai" ||
      rest === "stripe" ||
      rest === "stripe-errors" ||
      rest === "auth" ||
      rest === "envelope" ||
      rest === "async" ||
      rest === "mail" ||
      rest === "hmac" ||
      rest === "discriminator"
        ? rest
        : "plaid";
    return { primary, scenarioId: SCENARIOS[0].id, liveId };
  }
  return {
    primary,
    scenarioId: SCENARIOS[0].id,
    liveId: "plaid",
  };
}

function setHash(
  primary: PrimaryNav,
  opts?: { scenarioId?: string; liveId?: LiveScenarioId }
) {
  if (primary === "taxonomy") {
    window.location.hash = `taxonomy/${opts?.scenarioId ?? SCENARIOS[0].id}`;
  } else if (primary === "live") {
    window.location.hash = `live/${opts?.liveId ?? "plaid"}`;
  } else {
    window.location.hash = primary;
  }
}

export function App() {
  const initial = parseHash();
  const [primary, setPrimary] = useState<PrimaryNav>(initial.primary);
  const [scenarioId, setScenarioId] = useState(initial.scenarioId);
  const [liveId, setLiveId] = useState<LiveScenarioId>(initial.liveId);

  const syncFromHash = useCallback(() => {
    const next = parseHash();
    setPrimary(next.primary);
    setScenarioId(next.scenarioId);
    setLiveId(next.liveId);
  }, []);

  useEffect(() => {
    window.addEventListener("hashchange", syncFromHash);
    if (!window.location.hash) setHash("landing");
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [syncFromHash]);

  const go = (
    next: PrimaryNav,
    opts?: { scenarioId?: string; liveId?: LiveScenarioId }
  ) => {
    if (opts?.scenarioId) setScenarioId(opts.scenarioId);
    if (opts?.liveId) setLiveId(opts.liveId);
    setPrimary(next);
    setHash(next, {
      scenarioId: opts?.scenarioId ?? scenarioId,
      liveId: opts?.liveId ?? liveId,
    });
  };

  const activeCase = getScenario(scenarioId) ?? SCENARIOS[0];
  const liveScenario: Scenario = liveId;

  return (
    <div className="page">
      <header className="app-top">
        <div className="app-brand">
          <p className="eyebrow">MorphAPI · FYP</p>
          <strong>API drift · hybrid repair</strong>
        </div>
        <nav className="primary-nav" aria-label="Primary">
          {(
            [
              ["landing", "Landing"],
              ["taxonomy", "Failure taxonomy"],
              ["live", "Live demos"],
              ["context", "Industry context"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={primary === id ? "active" : ""}
              onClick={() => go(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {primary === "landing" && (
        <Landing
          onOpenTaxonomy={() => go("taxonomy", { scenarioId: SCENARIOS[0].id })}
          onOpenLive={(id) => go("live", { liveId: id })}
        />
      )}

      {primary === "taxonomy" && (
        <div className="taxonomy-layout">
          <aside className="taxonomy-nav" aria-label="Scenarios">
            <p className="eyebrow">10 failure modes</p>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={
                  scenarioId === s.id
                    ? "taxonomy-item active"
                    : "taxonomy-item"
                }
                onClick={() => go("taxonomy", { scenarioId: s.id })}
              >
                <span className="taxonomy-num">{s.number}</span>
                <span className="taxonomy-title">{s.title}</span>
                <span
                  className={`badge tiny ${s.demoStatus === "live" ? "live" : "taxonomy"}`}
                >
                  {s.demoStatus === "live" ? "Live" : "Taxonomy"}
                </span>
              </button>
            ))}
          </aside>
          <ScenarioCaseView
            scenario={activeCase}
            onOpenLive={(id) => go("live", { liveId: id })}
          />
        </div>
      )}

      {primary === "live" && (
        <div className="live-layout">
          <div
            className="scenario-switch"
            role="group"
            aria-label="Live baseline"
          >
            <button
              type="button"
              className={liveId === "morphpay" ? "active" : ""}
              onClick={() => go("live", { liveId: "morphpay" })}
            >
              MorphPay (1a)
            </button>
            <button
              type="button"
              className={liveId === "plaid" ? "active" : ""}
              onClick={() => go("live", { liveId: "plaid" })}
            >
              Plaid Link (1b)
            </button>
            <button
              type="button"
              className={liveId === "openai" ? "active" : ""}
              onClick={() => go("live", { liveId: "openai" })}
            >
              OpenAI engine (2)
            </button>
            <button
              type="button"
              className={liveId === "stripe" ? "active" : ""}
              onClick={() => go("live", { liveId: "stripe" })}
            >
              Unit shift (3)
            </button>
            <button
              type="button"
              className={liveId === "stripe-errors" ? "active" : ""}
              onClick={() => go("live", { liveId: "stripe-errors" })}
            >
              Error hierarchy (8)
            </button>
            <button
              type="button"
              className={liveId === "auth" ? "active" : ""}
              onClick={() => go("live", { liveId: "auth" })}
            >
              Evasion (4)
            </button>
            <button
              type="button"
              className={liveId === "envelope" ? "active" : ""}
              onClick={() => go("live", { liveId: "envelope" })}
            >
              Envelope / DFG (5)
            </button>
            <button
              type="button"
              className={liveId === "async" ? "active" : ""}
              onClick={() => go("live", { liveId: "async" })}
            >
              Async contagion (6)
            </button>
            <button
              type="button"
              className={liveId === "mail" ? "active" : ""}
              onClick={() => go("live", { liveId: "mail" })}
            >
              Multi-site (7)
            </button>
            <button
              type="button"
              className={liveId === "discriminator" ? "active" : ""}
              onClick={() => go("live", { liveId: "discriminator" })}
            >
              Discriminator (9)
            </button>
            <button
              type="button"
              className={liveId === "hmac" ? "active" : ""}
              onClick={() => go("live", { liveId: "hmac" })}
            >
              HMAC auth (10)
            </button>
          </div>
          <LiveDemo scenario={liveScenario} />
        </div>
      )}

      {primary === "context" && <ContextBriefing />}

      <footer className="foot">
        MorphAPI demo UI ·{" "}
        <code>
          #{primary}
          {primary === "taxonomy" ? `/${scenarioId}` : ""}
          {primary === "live" ? `/${liveId}` : ""}
        </code>{" "}
        · live baselines MorphPay · Plaid · OpenAI · Stripe · Auth JWT
      </footer>
    </div>
  );
}
