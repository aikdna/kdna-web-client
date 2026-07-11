import React from "react";

/** JudgmentTrace 0.9 + legacy 1.0 compat — consumed by web clients. */
export interface Trace {
  trace_version?: string;
  kdna_trace?: string;
  trace_id: string;
  timestamp: string;
  mode?: string;
  plan_id?: string;

  // Legacy
  operation?: string;
  decision?: TraceDecision;

  // 0.9
  asset_identity?: { asset_id: string; version: string; digest: string };
  assets_loaded?: Array<{
    asset_id: string; role: string; weight: number;
    contribution_hypothesis?: string; contribution_fulfilled?: boolean;
  }>;
  selection_actual?: { primary?: string | null; advisors?: string[]; rejected?: Array<{ asset_id: string; reason?: string }> };
  execution?: { status: string; runner_id?: string; model?: string; duration_ms?: number };
  result_ref?: { answer_summary?: string; result_stored?: boolean; result_shape?: string };
  cost?: { tokens_used?: number; tokens_consumed?: number; chars_consumed?: number; assets_loaded?: number; over_budget?: boolean; budget_profile?: string };
  evaluation?: { self_checks?: Array<{ check_id: string; passed: boolean }>; violations?: Array<{ type: string; severity: string; description?: string }> };
  provenance?: { plan_digest?: string; cluster_manifest_digest?: string; policy_hash?: string };
  warnings?: string[];
  errors?: string[];
}

interface TraceDecision {
  primary?: { domain_id: string; weight: number; reason?: string } | null;
  advisors?: { domain_id: string; weight: number; role?: string }[];
  rejected?: { domain_id: string; reason?: string }[];
  confidence?: string;
}

interface TraceViewerProps { trace: Trace; visible?: boolean }

export function TraceViewer({ trace, visible = false }: TraceViewerProps) {
  if (!visible) return null;

  const is09 = trace.trace_version === "0.9.0";
  const isCluster = trace.mode === "cluster";

  // Primary
  const primary09 = isCluster
    ? trace.assets_loaded?.find(a => a.role === "primary")?.asset_id ?? trace.selection_actual?.primary
    : trace.asset_identity?.asset_id;
  const primaryLegacy = trace.decision?.primary;
  const primary = primary09 ?? primaryLegacy?.domain_id ?? null;

  // Advisors
  const advisors09 = trace.assets_loaded?.filter(a => a.role === "advisor") ?? [];
  const advisorsLegacy = trace.decision?.advisors ?? [];
  const advisors = is09 ? advisors09.map(a => ({ domain_id: a.asset_id, weight: a.weight, hypothesis: a.contribution_hypothesis })) : advisorsLegacy;

  // Status
  const status = trace.execution?.status ?? "unknown";

  return (
    <div className="kdna-trace-viewer">
      <h3>Trace: {trace.trace_id}</h3>
      <div className="kdna-trace-operation">
        Mode: {trace.mode ?? "single"} | Status: {status}
        {trace.execution?.model && ` | Model: ${trace.execution.model}`}
      </div>

      <div className="kdna-trace-section">
        <h4>Primary</h4>
        {primary ? (
          <div>{primary} {trace.asset_identity && `v${trace.asset_identity.version}`}</div>
        ) : (
          <div className="kdna-empty">No primary resolved</div>
        )}
      </div>

      {advisors.length > 0 && (
        <div className="kdna-trace-section">
          <h4>Advisors ({advisors.length})</h4>
          <ul>
            {advisors.map((a, i) => (
              <li key={i}>
                {a.domain_id} {a.weight !== undefined && `(w: ${a.weight})`}
                {a.hypothesis && ` — ${a.hypothesis.slice(0, 80)}${a.hypothesis.length > 80 ? '...' : ''}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(trace.selection_actual?.rejected?.length ?? 0) > 0 && (
        <div className="kdna-trace-section">
          <h4>Rejected ({trace.selection_actual!.rejected!.length})</h4>
          <ul>
            {trace.selection_actual!.rejected!.map((r, i) => (
              <li key={i}>{r.asset_id} — {r.reason ?? "no reason"}</li>
            ))}
          </ul>
        </div>
      )}

      {trace.cost && (
        <div className="kdna-trace-section">
          <h4>Cost</h4>
          <div className="kdna-cost-bar">
            <CostBar label="Tokens" used={trace.cost.tokens_used ?? trace.cost.tokens_consumed ?? 0} overBudget={trace.cost.over_budget ?? false} />
            <CostBar label="Assets" used={trace.cost.assets_loaded ?? 0} overBudget={trace.cost.over_budget ?? false} />
          </div>
          {trace.cost.over_budget && <div className="kdna-over-budget">⚠ Over budget ({trace.cost.budget_profile ?? "unknown"} profile)</div>}
        </div>
      )}

      {is09 && trace.result_ref?.answer_summary && (
        <div className="kdna-trace-section">
          <h4>Result</h4>
          <div>{trace.result_ref.answer_summary}</div>
        </div>
      )}

      {is09 && (trace.evaluation?.self_checks?.length ?? 0) > 0 && (
        <div className="kdna-trace-section">
          <h4>Self-Checks</h4>
          {trace.evaluation!.self_checks!.map((c, i) => (
            <div key={i} className={c.passed ? "kdna-check-pass" : "kdna-check-fail"}>
              {c.passed ? "✓" : "✗"} {c.check_id}
            </div>
          ))}
        </div>
      )}

      {trace.warnings?.length && (
        <div className="kdna-trace-section kdna-warnings">
          <h4>Warnings</h4>
          {trace.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {trace.provenance && (
        <div className="kdna-trace-section">
          <h4>Provenance</h4>
          {trace.provenance.plan_digest && <div>Plan digest: {trace.provenance.plan_digest.slice(0, 20)}...</div>}
          {trace.provenance.policy_hash && <div>Policy hash: {trace.provenance.policy_hash.slice(0, 12)}</div>}
        </div>
      )}
    </div>
  );
}

function CostBar({ label, used, overBudget }: { label: string; used: number; overBudget: boolean }) {
  return (
    <div className="kdna-cost-row">
      <span>{label}: </span>
      <span>{used}</span>
      {overBudget && <span className="kdna-over-budget"> (over)</span>}
    </div>
  );
}
