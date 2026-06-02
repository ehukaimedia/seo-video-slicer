/**
 * types.ts — TypeScript shapes for every API.md response body (FROZEN contract).
 * One type per endpoint result, plus the shared `{name,url}` frame shape and the
 * single error envelope.
 */

/** The recurring frame shape (API.md §3). `url` is verbatim — keep any `?v=`. */
export interface FrameRef {
  name: string;
  url: string;
}

/** The single error envelope every non-2xx response carries (API.md §9.1). */
export interface ApiErrorBody {
  error: string;
  detail?: string;
}

/** POST /api/upload (API.md §5.1). */
export interface UploadResponse {
  job_id: string;
  filename: string;
  duration_s: number;
  width: number;
  height: number;
  fps: number;
  thumb_url: string;
}

/** GET /api/jobs/{job_id} (API.md §5.2). */
export interface JobResponse {
  job_id: string;
  filename: string;
  duration_s: number;
  width: number;
  height: number;
  slices: Array<{
    slice_id: string;
    frame_count: number;
    has_package: boolean;
  }>;
}

/** POST /api/jobs/{job_id}/preview (API.md §6.1). */
export interface PreviewResponse {
  preview_id: string;
  count: number;
  frames: FrameRef[];
}

/** POST /api/jobs/{job_id}/finalize (API.md §6.2). */
export interface FinalizeResponse {
  slice_id: string;
  count: number;
  frames: FrameRef[];
}

/** GET /api/jobs/{job_id}/slices/{slice_id} — re-open a saved slice's frames. */
export interface SliceFramesResponse {
  slice_id: string;
  count: number;
  frames: FrameRef[];
}

/** POST …/crop (API.md §7.1). */
export interface CropResponse {
  ok: true;
  crop_box: [number, number, number, number];
  frames: FrameRef[];
}

export type EraseTier = 'baseline' | 'premium';

/** POST …/erase (API.md §7.2). */
export interface EraseResponse {
  ok: true;
  tier_used: EraseTier;
  frames: FrameRef[];
}

/** One verify gate row (API.md §7.3 / §11.2). */
export interface VerifyGate {
  id: string;
  pass: boolean;
  detail: string;
}

export type Lane = 'hero' | 'scrollytelling' | 'over';

/** POST …/package (API.md §7.3). NOTE: returns 200 even when the gate fails. */
export interface PackageResponse {
  package_id: string;
  verify: {
    pass: boolean;
    gates: VerifyGate[];
  };
  frame_count: number;
  weight_mb: number;
  lane: Lane;
  /** null when verify.pass === false (API.md §7.3). */
  download_url: string | null;
  /** null when verify.pass === false (API.md §7.3). */
  preview_url: string | null;
}

/** GET /api/share (API.md §8.2). */
export interface ShareResponse {
  local: string;
  lan: string | null;
  tailscale: string | null;
}

/** One job row in GET /api/jobs (API.md §12.1). `created_at` is ISO-8601. */
export interface JobSummary {
  job_id: string;
  title: string;
  created_at: string;
  thumb_url: string;
  duration_s: number;
  resolution: string | null;
  slice_count: number;
  package_count: number;
}

/** GET /api/jobs (API.md §12.1). */
export interface JobsListResponse {
  jobs: JobSummary[];
}

/** PUT /api/jobs/{job_id} (API.md §12.2). */
export interface RenameJobResponse {
  ok: true;
  title: string;
}

/** One package row in GET /api/jobs/{job_id}/packages (API.md §12.4). */
export interface PackageSummary {
  package_id: string;
  slice_id: string;
  created_at: string;
  frame_count: number;
  weight_mb: number;
  lane: Lane;
  thumb_url: string | null;
  download_url: string | null;
}

/** GET /api/jobs/{job_id}/packages (API.md §12.4). */
export interface PackagesListResponse {
  packages: PackageSummary[];
}

/** DELETE responses share the `{ ok: true }` shape (API.md §12.3 / §12.5). */
export interface OkResponse {
  ok: true;
}
