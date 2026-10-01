import type { PipelineEvent } from "./api";

type Props = {
  events: PipelineEvent[];
  running: boolean;
};

export function TelemetryStream({ events, running }: Props) {
  return (
    <div className="wb-pane-body telemetry">
      <div className="telemetry-head">
        <span className={`pulse ${running ? "on" : ""}`} />
        <span>{running ? "Pipeline live…" : "Pipeline idle"}</span>
      </div>
      <ol className="telemetry-log">
        {events.length === 0 ? (
          <li className="muted">
            Run a scenario to stream AST scan → AI-alone → inspector → gate.
          </li>
        ) : (
          events.map((e, i) => (
            <li
              key={`${e.t}-${e.type}-${i}`}
              className={`tel-${e.type} ${
                e.type.includes("reject")
                  ? "reject"
                  : e.type.includes("accept") || e.type === "done"
                    ? "accept"
                    : ""
              }`}
            >
              <time>{e.t?.slice(11, 19) ?? "--:--:--"}</time>
              <span className="tel-type">{e.type}</span>
              <span className="tel-msg">{e.message ?? ""}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
