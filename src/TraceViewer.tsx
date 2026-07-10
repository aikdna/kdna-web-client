import React from "react";

export interface Trace {
  kdna_trace: string;
  trace_id: string;
  timestamp: string;
  operation: string;
  decision: TraceDecision;
  cost?: TraceCost;
  projection?: TraceProjection;
  provenance?: TraceProvenance;
}

interface TraceDecision {
  primary?: { domain_id: string; weight: number; reason?: string } | null;
  advisors?: { domain_id: string; weight: number; role?: string }[];
  rejected?: { domain_id: string; reason?: string }[];
  budget_profile?: string;
  confidence?: string;
  abstain_reason?: string;
}

interface TraceCost {
  tokens_consumed: number;
  chars_consumed: number;
  assets_loaded: number;
  over_budget: boolean;
  limits?: { maxTokens: number; maxChars: number; maxAssets: number };
}

interface TraceProjection {
  shape: string;
}

interface TraceProvenance {
  route_card_version?: string;
  consumer_index_version?: string;
  policy_input_hash?: string;
}

interface TraceViewerProps {
  trace: Trace;
  visible?: boolean;
}

export function TraceViewer({ trace, visible = false }: TraceViewerProps) {
  if (!visible) return null;

  const primary = trace.decision?.primary;
  const advisors = trace.decision?.advisors ?? [];
  const rejected = trace.decision?.rejected ?? [];

  return (
    <div className="kdna-trace-viewer">
      <h3>Trace: {trace.trace_id}</h3>
      <div className="kdna-trace-operation">
        Operation: {trace.operation} | Confidence:{" "}
        {trace.decision?.confidence ?? "unknown"}
      </div>

      <div className="kdna-trace-section">
        <h4>Primary</h4>
        {primary ? (
          <div>
            {primary.domain_id} (weight: {primary.weight})
          </div>
        ) : (
          <div className="kdna-empty">No primary domain resolved</div>
        )}
      </div>

      {advisors.length > 0 && (
        <div className="kdna-trace-section">
          <h4>Advisors ({advisors.length})</h4>
          <ul>
            {advisors.map((a, i) => (
              <li key={i}>
                {a.domain_id} — {a.role ?? "advisor"} (weight: {a.weight})
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="kdna-trace-section">
          <h4>Rejected ({rejected.length})</h4>
          <ul>
            {rejected.map((r, i) => (
              <li key={i}>
                {r.domain_id} — {r.reason ?? "no reason"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {trace.cost && (
        <div className="kdna-trace-section">
          <h4>Cost</h4>
          <div className="kdna-cost-bar">
            <CostBar label="Tokens" used={trace.cost.tokens_consumed} limit={trace.cost.limits?.maxTokens} overBudget={trace.cost.over_budget} />
            <CostBar label="Chars" used={trace.cost.chars_consumed} limit={trace.cost.limits?.maxChars} overBudget={trace.cost.over_budget} />
            <CostBar label="Assets" used={trace.cost.assets_loaded} limit={trace.cost.limits?.maxAssets} overBudget={trace.cost.over_budget} />
          </div>
        </div>
      )}

      {trace.provenance && (
        <div className="kdna-trace-section">
          <h4>Provenance</h4>
          <div>
            Policy hash: {trace.provenance.policy_input_hash ?? "none"}
          </div>
          <div>
            Consumer index:{" "}
            {trace.provenance.consumer_index_version ?? "none"}
          </div>
        </div>
      )}
    </div>
  );
}

function CostBar({
  label,
  used,
  limit,
  overBudget,
}: {
  label: string;
  used: number;
  limit?: number;
  overBudget: boolean;
}) {
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="kdna-cost-row">
      <span>{label}: </span>
      <span>{used}</span>
      {limit && limit > 0 && <span> / {limit}</span>}
      <div className="kdna-cost-bar-outer">
        <div
          className={`kdna-cost-bar-inner ${overBudget ? "kdna-over-budget" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
