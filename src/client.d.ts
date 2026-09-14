import type { AssetIdentity, AssetDigests, VersionTuple, CoreStaticStates, ReadDiagnostic, CoreComponentFailure } from '@aikdna/kdna-core';
import type { ReadTransportContext, ReadTransportAdmissionResult, ReadTransportAccepted } from '@aikdna/kdna-read/transport';
declare const selectionBrand: unique symbol;
export type KDNASelection = Readonly<{ [selectionBrand]: true; kind: 'kdna.web-client-selection/1'; byteLength: number;
  fileName: string | null; asset: AssetIdentity; tuple: VersionTuple; digests: AssetDigests }>;
export type SelectionResult = Readonly<{ status: 'selected'; selection: KDNASelection; code: null }>
  | Readonly<{ status: 'rejected'; selection: null; code: string; states?: never; diagnostics?: never; component_failure?: never }>
  | Readonly<{ status: 'rejected'; selection: null; code: string; states: CoreStaticStates; diagnostics: readonly ReadDiagnostic[]; component_failure: CoreComponentFailure | null }>;
export type RemoteReadViewModel = Readonly<{ kind: 'remote_read'; origin: 'remote';
  association: ReadTransportAccepted['association']; response: ReadTransportAccepted['response'];
  proof_scope: ReadTransportAccepted['proof_scope']; proof_limits: ReadTransportAccepted['proof_limits'];
  capabilities: ReadTransportAccepted['capabilities'] }>;
export type ClientResult = Readonly<{ status: 'received'; code: null; admission: ReadTransportAccepted; view: RemoteReadViewModel }>
  | Readonly<{ status: 'rejected'; code: string; admission: ReadTransportAdmissionResult; view: null }>
  | Readonly<{ status: 'failed'; code: string; admission: null; view: null }>;
export declare function selectKDNA(input: File | Blob | ArrayBuffer | Uint8Array, options?: { maxFileBytes?: number }): Promise<SelectionResult>;
export declare function releaseKDNASelection(selection: KDNASelection): void;
export declare function createKDNAWebClient(options: { endpointUrl: string; endpointId: string; sessionId: string;
  timeoutMs?: number; maxConcurrentRequests?: number; fetch?: typeof globalThis.fetch }): Readonly<{
  read(selection: KDNASelection, context: ReadTransportContext, settings?: { signal?: AbortSignal }): Promise<ClientResult>;
  dispose(): void;
}>;
