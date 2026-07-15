export interface KDNAErrorOptions {
  code?: string;
  status?: number;
  response?: unknown;
  cause?: unknown;
  maxSizeBytes?: number;
  actualSizeBytes?: number;
}

export class KDNAFormatError extends Error {
  code: string;
  cause?: unknown;
  constructor(message: string, options?: KDNAErrorOptions);
}

export class KDNAFileSizeError extends Error {
  code: string;
  maxSizeBytes: number | null;
  actualSizeBytes: number | null;
  constructor(message: string, options?: KDNAErrorOptions);
}

export class KDNAUploadError extends Error {
  code: string;
  status: number | null;
  response: unknown;
  cause?: unknown;
  constructor(message: string, options?: KDNAErrorOptions);
}

export class KDNALoadError extends Error {
  code: string;
  status: number | null;
  response: unknown;
  cause?: unknown;
  constructor(message: string, options?: KDNAErrorOptions);
}

export interface KDNAMetadata {
  domain: string | null;
  version: string | null;
  title: string | null;
  description: string | null;
  encrypted: boolean;
  profiles: string[];
  fileSize: number;
  manifest: Record<string, unknown>;
  entries: string[];
}

export function readKDNAMetadata(
  file: Blob,
  options?: { maxSizeBytes?: number },
): Promise<KDNAMetadata>;

export function uploadKDNA(
  file: File,
  endpoint: string,
  options?: { fieldName?: string; fetch?: typeof fetch; headers?: HeadersInit },
): Promise<{ fileId: string; inspect: Record<string, unknown> }>;

export class KDNALoadPlanManager {
  constructor(baseUrl: string, options?: { fetch?: typeof fetch; headers?: HeadersInit });
  endpoint(path: string): string;
  post(path: string, body: unknown): Promise<Record<string, unknown>>;
  planLoad(fileId: string, context?: Record<string, unknown>): Promise<{
    canProceed: boolean;
    missing: unknown[];
    requirements: {
      password: { required: boolean; hint: string | null };
      licenseKey: { required: boolean };
    };
    plan: Record<string, unknown>;
    response: Record<string, unknown>;
  }>;
  load(fileId: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface JudgmentTrace {
  type: 'kdna.judgment-trace';
  contract_version: '0.1.0';
  trace_id: string;
  plan_ref: {
    plan_id: string;
    plan_digest_profile: 'kdna.canonicalization.consumption-plan-jcs';
    plan_digest_profile_version: '0.1.0';
    plan_digest: string;
    comparison: 'matched';
  };
  parent_trace_id: string | null;
  timestamp: string;
  overall_status: 'execution_completed' | 'blocked' | 'execution_failed' | 'cancelled' | 'timed_out';
  runtime_contract: Record<string, unknown>;
  asset_identity: {
    asset_id: string;
    asset_uid: string;
    version: string;
    judgment_version: string;
    access: 'public' | 'licensed' | 'remote';
  };
  digest_evidence: Record<string, unknown>;
  capsule_delivery_evidence: Record<string, unknown>;
  projection_actual: {
    profile: 'index' | 'compact' | 'scenario' | 'full' | null;
    capsule_delivery_digest: string | null;
    profile_deviated_from_plan: boolean | null;
  };
  host_receipt: Record<string, unknown> | null;
  execution: {
    delivery_status: 'correlated_response' | 'rejected_before_execution' | 'not_delivered';
    semantic_consumption: { state: 'not_observed'; basis: null };
    execution_status: 'completed' | 'not_started' | 'failed' | 'cancelled' | 'timed_out';
    conformance_status: 'not_evaluated';
    model_identity: { value: string | null; basis: 'host_reported' | 'not_observed' };
  };
  budget: {
    limits: Record<string, number | null>;
    actual: {
      projection_chars: number | null;
      task_chars: number;
      elapsed_ms: number | null;
      elapsed_basis: 'host_monotonic' | 'not_observed';
      tokens_used: number | null;
      model_calls: number | null;
      usage_basis: 'host_reported' | 'not_observed';
    };
    comparison: {
      projection_chars: string;
      task_chars: string;
      elapsed_ms: string;
      tokens_used: string;
      model_calls: string;
      overall: 'within_limit' | 'exceeded' | 'not_observed';
    };
  };
  result_ref: {
    shape: 'structured_judgment';
    result_digest: string;
    basis: 'kdna.canonicalization.result-jcs';
    stored: boolean;
  } | null;
  errors: Array<{ code: string; message: string; phase: string }>;
  warnings: string[];
}

export interface JudgmentTraceView {
  traceId: string;
  status: JudgmentTrace['overall_status'];
  primary: string;
  assetVersion: string;
  deliveryStatus: JudgmentTrace['execution']['delivery_status'];
  executionStatus: JudgmentTrace['execution']['execution_status'];
  semanticConsumption: 'not_observed';
  conformanceStatus: 'not_evaluated';
  modelIdentity: string | null;
  modelIdentityBasis: 'host_reported' | 'not_observed';
  tokensUsed: number | null;
  usageBasis: 'host_reported' | 'not_observed';
  budgetStatus: 'within_limit' | 'exceeded' | 'not_observed';
  projectionProfile: JudgmentTrace['projection_actual']['profile'];
  planDigest: string;
  capsuleDeliveryDigest: string | null;
  resultDigest: string | null;
  resultStored: boolean;
  errors: JudgmentTrace['errors'];
  warnings: string[];
}

export function validateJudgmentTrace(trace: unknown): { valid: boolean; errors: string[] };
export function parseJudgmentTrace(json: string): JudgmentTrace;
export function judgmentTraceView(trace: JudgmentTrace): JudgmentTraceView;

export class JudgmentTraceViewer {
  constructor(container: Element);
  render(trace: JudgmentTrace): JudgmentTraceView;
  clear(): void;
}
