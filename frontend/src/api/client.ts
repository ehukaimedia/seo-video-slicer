/**
 * client.ts — the single typed wrapper over the FROZEN HTTP API (API.md).
 *
 * Every non-2xx response is the `{error, detail?}` envelope (API.md §9.1); this
 * is the ONE place it is parsed and turned into a typed `ApiError`. Components
 * never call `fetch` directly and never see a raw Response.
 *
 * IMPORTANT: `POST …/package` returns HTTP 200 even when the quality gate FAILS
 * (API.md §7.3). This wrapper therefore does NOT treat a failed gate as an
 * error — callers inspect `response.verify.pass`.
 */
import type {
  ApiErrorBody,
  CropResponse,
  EraseResponse,
  EraseTier,
  FinalizeResponse,
  JobResponse,
  JobsListResponse,
  OkResponse,
  PackageResponse,
  PackagesListResponse,
  PreviewResponse,
  RenameJobResponse,
  ShareResponse,
  SliceFramesResponse,
  UploadResponse,
} from './types';

/** A typed error carrying the contract envelope plus the HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = body.detail;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = { error: `Request failed (${res.status})` };
  try {
    const parsed = (await res.json()) as Partial<ApiErrorBody>;
    if (parsed && typeof parsed.error === 'string') {
      body = { error: parsed.error, detail: parsed.detail };
    }
  } catch {
    // Non-JSON error body (e.g. a proxy failure). Keep the generic envelope.
  }
  return new ApiError(res.status, body);
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return asJson<T>(res);
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return asJson<T>(res);
}

/** POST /api/upload — multipart form, field name `file` (API.md §5.1). */
export async function upload(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  return asJson<UploadResponse>(res);
}

/** GET /api/jobs/{job_id} (API.md §5.2). */
export async function getJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`/api/jobs/${jobId}`);
  return asJson<JobResponse>(res);
}

/** GET /api/jobs/{job_id}/slices/{slice_id} — load a saved slice's frames. */
export async function getSlice(
  jobId: string,
  sliceId: string,
): Promise<SliceFramesResponse> {
  const res = await fetch(`/api/jobs/${jobId}/slices/${sliceId}`);
  return asJson<SliceFramesResponse>(res);
}

/** DELETE /api/jobs/{job_id}/slices/{slice_id} — remove a saved slice. */
export async function deleteSlice(
  jobId: string,
  sliceId: string,
): Promise<OkResponse> {
  const res = await fetch(`/api/jobs/${jobId}/slices/${sliceId}`, {
    method: 'DELETE',
  });
  return asJson<OkResponse>(res);
}

/** POST /api/jobs/{job_id}/preview (API.md §6.1). */
export function preview(
  jobId: string,
  args: { start: number; end: number; fps: number },
): Promise<PreviewResponse> {
  return postJson<PreviewResponse>(`/api/jobs/${jobId}/preview`, args);
}

/** POST /api/jobs/{job_id}/finalize (API.md §6.2). */
export function finalize(
  jobId: string,
  args: { preview_id: string; excluded: string[] },
): Promise<FinalizeResponse> {
  return postJson<FinalizeResponse>(`/api/jobs/${jobId}/finalize`, args);
}

/** POST …/crop — auto or manual (API.md §7.1). */
export function crop(
  jobId: string,
  sliceId: string,
  args:
    | { mode: 'auto' }
    | { mode: 'manual'; box: [number, number, number, number] },
): Promise<CropResponse> {
  return postJson<CropResponse>(
    `/api/jobs/${jobId}/slices/${sliceId}/crop`,
    args,
  );
}

/** POST …/erase — two-tier inpaint (API.md §7.2). */
export function erase(
  jobId: string,
  sliceId: string,
  args: { box: [number, number, number, number]; tier?: 'auto' | EraseTier },
): Promise<EraseResponse> {
  return postJson<EraseResponse>(
    `/api/jobs/${jobId}/slices/${sliceId}/erase`,
    args,
  );
}

/**
 * POST …/package — build via build_package.mjs, gate via verify.mjs (API.md §7.3).
 * Resolves on HTTP 200 even when `verify.pass === false`; the caller decides.
 */
export function buildPackage(
  jobId: string,
  sliceId: string,
  args: { slug?: string; headline?: string; accent?: string },
): Promise<PackageResponse> {
  return postJson<PackageResponse>(
    `/api/jobs/${jobId}/slices/${sliceId}/package`,
    args,
  );
}

/** GET /api/share — local / LAN / Tailscale URLs (API.md §8.2). */
export async function getShare(): Promise<ShareResponse> {
  const res = await fetch('/api/share');
  return asJson<ShareResponse>(res);
}

/** GET /api/jobs — list ALL jobs, newest first (API.md §12.1). */
export async function listJobs(): Promise<JobsListResponse> {
  const res = await fetch('/api/jobs');
  return asJson<JobsListResponse>(res);
}

/** PUT /api/jobs/{job_id} — rename a job (API.md §12.2). */
export function renameJob(
  jobId: string,
  title: string,
): Promise<RenameJobResponse> {
  return putJson<RenameJobResponse>(`/api/jobs/${jobId}`, { title });
}

/** DELETE /api/jobs/{job_id} — delete a job + everything under it (API.md §12.3). */
export async function deleteJob(jobId: string): Promise<OkResponse> {
  const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  return asJson<OkResponse>(res);
}

/** GET /api/jobs/{job_id}/packages — every package under a job (API.md §12.4). */
export async function listPackages(
  jobId: string,
): Promise<PackagesListResponse> {
  const res = await fetch(`/api/jobs/${jobId}/packages`);
  return asJson<PackagesListResponse>(res);
}

/** DELETE /api/jobs/{job_id}/packages/{package_id} — delete one package (API.md §12.5). */
export async function deletePackage(
  jobId: string,
  packageId: string,
): Promise<OkResponse> {
  const res = await fetch(`/api/jobs/${jobId}/packages/${packageId}`, {
    method: 'DELETE',
  });
  return asJson<OkResponse>(res);
}
