/**
 * store.tsx — the single app store: one reducer + context + thin action hooks.
 *
 * No Redux, no zustand. Models the slicer pipeline as a step machine:
 *   upload → trim → review → clean → export
 * Crop/erase operate on the finalized SLICE, so they are only reachable once a
 * slice exists (API.md §6.2 precedes §7). Async ops are tracked by a `busy`
 * label + a single `error` string consumed by the chrome.
 */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import { DEFAULT_SLICE_SECONDS, MAX_SLICE_SECONDS, FPS_PRESETS } from '../config';
import type {
  FrameRef,
  JobResponse,
  PackageResponse,
  PackageSummary,
  PreviewResponse,
  ShareResponse,
  UploadResponse,
} from '../api/types';

/** Top-level surface: the library dashboard or the slicer workspace. */
export type View = 'dashboard' | 'slicer';

export type Step = 'upload' | 'trim' | 'review' | 'clean' | 'export';

export interface JobState {
  jobId: string;
  filename: string;
  durationS: number;
  width: number;
  height: number;
  /** Source fps — present on fresh upload (§5.1); absent when a job is re-opened
   * via GET /api/jobs/{id} (§5.2 omits it). `null` ⇒ unknown; guard the readout. */
  fps: number | null;
  thumbUrl: string;
}

/** One slice listed in the slicer's "SAVED SLICES" rail (from GET /api/jobs/{id}). */
export interface SliceSummary {
  sliceId: string;
  frameCount: number;
  hasPackage: boolean;
}

export interface TrimState {
  start: number;
  end: number;
  fps: number;
}

export interface AppState {
  /** Which top-level surface is showing (dashboard library vs. slicer). */
  view: View;
  step: Step;
  job: JobState | null;
  trim: TrimState;
  preview: PreviewResponse | null;
  /** Bare preview-frame basenames the user has excluded (API.md §6.2). */
  excluded: Set<string>;
  sliceId: string | null;
  /** Live slice frames (mutated in place by crop/erase; `url` keeps `?v`). */
  sliceFrames: FrameRef[];
  /** Slices under the open job, for the slicer's SAVED SLICES rail (§5.2). */
  slices: SliceSummary[];
  /** Built packages under the open job, for the PACKAGES rail (§12.4). */
  packages: PackageSummary[];
  lastEraseTier: 'baseline' | 'premium' | null;
  lastCropBox: [number, number, number, number] | null;
  pkg: PackageResponse | null;
  share: ShareResponse | null;
  /** A short label for the in-flight op, or null when idle. */
  busy: string | null;
  /** Human error envelope text, or null. Cleared on any new action. */
  error: string | null;
  /** Transient confirmation toast text, or null. */
  toast: string | null;
}

const DEFAULT_FPS = FPS_PRESETS[1]; // 6 — a sane middle preset

export const initialState: AppState = {
  view: 'dashboard',
  step: 'upload',
  job: null,
  trim: { start: 0, end: DEFAULT_SLICE_SECONDS, fps: DEFAULT_FPS },
  preview: null,
  excluded: new Set<string>(),
  sliceId: null,
  sliceFrames: [],
  slices: [],
  packages: [],
  lastEraseTier: null,
  lastCropBox: null,
  pkg: null,
  share: null,
  busy: null,
  error: null,
  toast: null,
};

export type Action =
  | { type: 'reset' }
  | { type: 'busy'; label: string | null }
  | { type: 'error'; message: string | null }
  | { type: 'toast'; message: string | null }
  | { type: 'goto'; step: Step }
  | { type: 'goDashboard' }
  | { type: 'newSlice' }
  | { type: 'openedJob'; res: JobResponse }
  | { type: 'setSlices'; slices: SliceSummary[] }
  | { type: 'setPackages'; packages: PackageSummary[] }
  | { type: 'uploaded'; res: UploadResponse }
  | { type: 'setTrim'; patch: Partial<TrimState> }
  | { type: 'previewed'; res: PreviewResponse }
  | { type: 'toggleExclude'; name: string }
  | { type: 'finalized'; sliceId: string; frames: FrameRef[] }
  | { type: 'selectedSlice'; sliceId: string; frames: FrameRef[] }
  | { type: 'removedSlice'; sliceId: string }
  | { type: 'sliceFrames'; frames: FrameRef[] }
  | { type: 'cropped'; box: [number, number, number, number]; frames: FrameRef[] }
  | { type: 'erased'; tier: 'baseline' | 'premium'; frames: FrameRef[] }
  | { type: 'packaged'; res: PackageResponse }
  | { type: 'share'; res: ShareResponse };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'reset':
      // Back to the library home — a fresh slate, share URLs preserved.
      return { ...initialState, share: state.share };
    case 'goDashboard':
      return { ...initialState, share: state.share };
    case 'newSlice':
      // Enter the slicer at the upload step for a brand-new clip.
      return {
        ...initialState,
        view: 'slicer',
        step: 'upload',
        share: state.share,
      };
    case 'busy':
      return { ...state, busy: action.label, error: action.label ? null : state.error };
    case 'error':
      return { ...state, error: action.message, busy: null };
    case 'toast':
      return { ...state, toast: action.message };
    case 'goto':
      return { ...state, step: action.step, error: null };
    case 'setSlices':
      return { ...state, slices: action.slices };
    case 'setPackages':
      return { ...state, packages: action.packages };
    case 'openedJob': {
      const { res } = action;
      // Re-opened an existing job (§5.2). Note: this response carries NO `fps`
      // and NO `thumb_url`; fps is unknown (null, guarded at readout) and the
      // poster path is reconstructed from the §3 convention.
      const end = Math.min(res.duration_s, DEFAULT_SLICE_SECONDS, MAX_SLICE_SECONDS);
      return {
        ...initialState,
        view: 'slicer',
        step: 'trim',
        share: state.share,
        job: {
          jobId: res.job_id,
          filename: res.filename,
          durationS: res.duration_s,
          width: res.width,
          height: res.height,
          fps: null,
          thumbUrl: `/data/jobs/${res.job_id}/thumb.jpg`,
        },
        trim: { start: 0, end, fps: DEFAULT_FPS },
        slices: res.slices.map((s) => ({
          sliceId: s.slice_id,
          frameCount: s.frame_count,
          hasPackage: s.has_package,
        })),
      };
    }
    case 'uploaded': {
      const { res } = action;
      // Auto-set the out-point to the default slice length, clamped to source
      // duration and the hard ceiling (spec §5.1).
      const end = Math.min(res.duration_s, DEFAULT_SLICE_SECONDS, MAX_SLICE_SECONDS);
      return {
        ...state,
        view: 'slicer',
        step: 'trim',
        error: null,
        job: {
          jobId: res.job_id,
          filename: res.filename,
          durationS: res.duration_s,
          width: res.width,
          height: res.height,
          fps: res.fps,
          thumbUrl: res.thumb_url,
        },
        trim: { start: 0, end, fps: DEFAULT_FPS },
        preview: null,
        excluded: new Set<string>(),
        sliceId: null,
        sliceFrames: [],
        slices: [],
        packages: [],
        pkg: null,
      };
    }
    case 'setTrim':
      return { ...state, trim: { ...state.trim, ...action.patch } };
    case 'previewed':
      return {
        ...state,
        step: 'review',
        error: null,
        preview: action.res,
        excluded: new Set<string>(),
      };
    case 'toggleExclude': {
      const next = new Set(state.excluded);
      if (next.has(action.name)) next.delete(action.name);
      else next.add(action.name);
      return { ...state, excluded: next };
    }
    case 'finalized':
      return {
        ...state,
        step: 'clean',
        error: null,
        sliceId: action.sliceId,
        sliceFrames: action.frames,
        lastEraseTier: null,
        lastCropBox: null,
        pkg: null,
      };
    case 'selectedSlice':
      // Re-open a SAVED SLICE: make it the active slice and drop the user into
      // Clean, where crop/erase/export operate on it (same landing as finalize).
      return {
        ...state,
        step: 'clean',
        error: null,
        sliceId: action.sliceId,
        sliceFrames: action.frames,
        lastEraseTier: null,
        lastCropBox: null,
        pkg: null,
      };
    case 'removedSlice': {
      const slices = state.slices.filter((s) => s.sliceId !== action.sliceId);
      const wasActive = state.sliceId === action.sliceId;
      return {
        ...state,
        slices,
        sliceId: wasActive ? null : state.sliceId,
        sliceFrames: wasActive ? [] : state.sliceFrames,
        pkg: wasActive ? null : state.pkg,
        step: wasActive ? 'trim' : state.step,
      };
    }
    case 'sliceFrames':
      return { ...state, sliceFrames: action.frames };
    case 'cropped':
      return {
        ...state,
        sliceFrames: action.frames,
        lastCropBox: action.box,
      };
    case 'erased':
      return {
        ...state,
        sliceFrames: action.frames,
        lastEraseTier: action.tier,
      };
    case 'packaged':
      return { ...state, step: 'export', error: null, pkg: action.res };
    case 'share':
      return { ...state, share: action.res };
    default:
      return state;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
