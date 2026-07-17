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

export declare const KDNA_SCHEMA_AUTHORITY: Readonly<{
  core_commit: '1e77e3e0d486c330fe9f9262b514ef24c859d469';
  aggregate_sha256: '8c38138e18ac5b465d779aeaf9fadcdd846236b0f96e7b144a6cc5c228ad480d';
  judgment_trace_sha256: 'a260e5abbcc68bf8df11ba738b5d475901b2950668c4718e415355adc723c7b0';
  runtime_capsule_sha256: '0219870a83fffddee4fa869cd1976c7ee55bcfa5fd4a44dc4032e126500333db';
}>;

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
  load(fileId: string, options?: Record<string, unknown>): Promise<KDNALoadResponse>;
}

export type KDNAJsonValue = null | boolean | number | string | KDNAJsonValue[] | {
  [key: string]: KDNAJsonValue;
};

export interface KDNADigestComparison {
  state: 'matched' | 'mismatched' | 'not_compared' | 'unavailable';
  against: 'external_expected' | 'manifest_declaration' | 'checksum_declaration' | null;
  expected: string | null;
  source:
    | 'caller'
    | 'registry'
    | 'install_receipt'
    | 'lockfile'
    | 'kdna.json.content_digest'
    | 'kdna.json.authoring.content_digest'
    | 'checksums.json.entry_set_digest'
    | null;
}

export interface KDNADigestValue {
  value: string | null;
  basis: string;
  comparison: KDNADigestComparison;
}

export interface KDNADigestEvidence {
  profile: 'kdna.digest-evidence';
  profile_version: '0.1.0';
  asset: KDNADigestValue;
  content: KDNADigestValue;
  runtime_entry_set: KDNADigestValue;
}

export interface KDNARuntimeCapsule {
  type: 'kdna.runtime-capsule';
  contract_version: '0.1.0';
  asset: {
    asset_id: string;
    asset_uid: string;
    version: string;
    judgment_version: string;
  };
  digests: KDNADigestEvidence;
  signature: { state: 'verified' | 'not_checked' | 'absent'; issuer?: string };
  access: 'public' | 'licensed' | 'remote';
  profile: 'index' | 'compact' | 'scenario' | 'full';
  context: { [key: string]: KDNAJsonValue };
  trace: {
    payload_encoding: 'cbor';
    loaded_by: 'kdna-core';
    loaded_at: string;
    input_kind: 'packaged_file' | 'packaged_bytes';
    runtime_eligible: true;
    schema_valid: true;
    signature_state: 'verified' | 'not_checked' | 'absent';
    profile: 'index' | 'compact' | 'scenario' | 'full';
  };
}

export interface KDNALoadResponse {
  capsule: KDNARuntimeCapsule;
  content?: KDNARuntimeCapsule['context'];
  profile?: KDNARuntimeCapsule['profile'];
}

export interface JudgmentTraceHostCapabilities {
  type: 'kdna.agent-host-capabilities';
  protocol_version: '0.1.0';
  capability_basis: 'registered_descriptor' | 'legacy_assumption';
  host_protocols: Array<'kdna.agent-host'>;
  capsule_versions: Array<'0.1.0'>;
  capsule_digest_profiles: Array<'kdna.canonicalization.runtime-capsule-jcs'>;
  capsule_digest_profile_versions: ['0.1.0'];
}

export interface JudgmentTraceHostReceipt {
  protocol: 'kdna.agent-host';
  protocol_version: '0.1.0';
  request_id: string;
  runtime_receipt: {
    type: 'kdna.agent-host.runtime-receipt';
    contract_version: '0.1.0';
    capsule_version: '0.1.0';
    capsule_digest_profile: 'kdna.canonicalization.runtime-capsule-jcs';
    capsule_digest_profile_version: '0.1.0';
    sender_capsule_delivery_digest: string;
    host_recomputed_capsule_delivery_digest: string;
    echoed_capsule_delivery_digest: string;
    capsule_delivery_comparison: 'matched' | 'mismatched';
    capsule_schema_validation: 'passed';
    asset_id_correlation: 'matched';
    provider_execution_status: 'completed' | 'not_started' | 'failed' | 'cancelled' | 'timed_out';
    semantic_consumption: { state: 'not_observed'; basis: null };
    model_identity: { value: string | null; basis: 'host_reported' | 'not_observed' };
    usage: {
      elapsed_ms: number;
      elapsed_basis: 'host_monotonic';
      tokens_used: number | null;
      model_calls: number | null;
      basis: 'host_reported' | 'not_observed';
    };
  };
  outcome: {
    judgment: { answer: string; reasoning: string[]; confidence: string | null };
    usage: { tokens_used: number; model_calls: number } | null;
  } | null;
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
  runtime_contract: {
    plan_capsule_versions: ['0.1.0'];
    core_capsule_versions: Array<'0.1.0'>;
    plan_host_protocols: ['kdna.agent-host'];
    host_capabilities: JudgmentTraceHostCapabilities;
    negotiation_state: 'selected' | 'blocked' | 'not_started';
    selected_capsule_version: '0.1.0' | null;
    selected_host_protocol: 'kdna.agent-host' | null;
    issue_code:
      | 'KDNA_CAPSULE_CONTRACT_VERSION_UNSUPPORTED'
      | 'KDNA_HOST_PROTOCOL_UNSUPPORTED'
      | 'KDNA_HOST_CAPSULE_PAIR_UNSUPPORTED'
      | null;
  };
  asset_identity: {
    asset_id: string;
    asset_uid: string;
    version: string;
    judgment_version: string;
    access: 'public' | 'licensed' | 'remote';
  };
  digest_evidence: KDNADigestEvidence;
  capsule_delivery_evidence: {
    basis: 'kdna.canonicalization.runtime-capsule-jcs';
    basis_version: '0.1.0';
    observed: string | null;
    sender_computed: boolean;
    host_recomputed: string | null;
    host_echoed: string | null;
    delivered_capsule_version: '0.1.0' | null;
    host_boundary_comparison: 'matched' | 'mismatched' | 'not_delivered' | 'not_observed' | 'unavailable';
    request_id: string | null;
  };
  projection_actual: {
    profile: 'index' | 'compact' | 'scenario' | 'full' | null;
    capsule_delivery_digest: string | null;
    profile_deviated_from_plan: boolean | null;
  };
  host_receipt: JudgmentTraceHostReceipt | null;
  execution: {
    delivery_status: 'correlated_response' | 'rejected_before_execution' | 'not_delivered';
    semantic_consumption: { state: 'not_observed'; basis: null };
    execution_status: 'completed' | 'not_started' | 'failed' | 'cancelled' | 'timed_out';
    conformance_status: 'not_evaluated';
    model_identity: { value: string | null; basis: 'host_reported' | 'not_observed' };
  };
  budget: {
    limits: {
      max_projection_chars: number;
      max_task_chars: number;
      deadline_ms: number;
      max_tokens: number | null;
      max_model_calls: number | null;
    };
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
      projection_chars: 'within_limit' | 'exceeded' | 'not_observed';
      task_chars: 'within_limit' | 'exceeded';
      elapsed_ms: 'within_limit' | 'exceeded' | 'not_observed';
      tokens_used: 'within_limit' | 'exceeded' | 'not_limited' | 'not_observed';
      model_calls: 'within_limit' | 'exceeded' | 'not_limited' | 'not_observed';
      overall: 'within_limit' | 'exceeded' | 'not_observed';
    };
  };
  result_ref: {
    shape: 'structured_judgment';
    result_digest: string;
    basis: 'kdna.canonicalization.result-jcs';
    stored: boolean;
  } | null;
  errors: Array<{
    code: string;
    message: string;
    phase: 'plan' | 'negotiation' | 'load' | 'budget' | 'delivery' | 'host' | 'execution';
  }>;
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
