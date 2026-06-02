/**
 * actions.ts — async action hooks bridging the store and the API client.
 *
 * Each wraps a client call with the busy → result/error lifecycle so components
 * stay declarative. The single `{error}` envelope (API.md §9.1) surfaces as a
 * string in the store; the chrome renders it.
 */
import { useCallback } from 'react';
import * as api from '../api/client';
import { ApiError } from '../api/client';
import type { EraseTier } from '../api/types';
import { useStore } from './store';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detail ? `${err.message} (${err.detail})` : err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unexpected error.';
}

export function useActions() {
  const { state, dispatch } = useStore();

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      dispatch({ type: 'busy', label });
      try {
        const result = await fn();
        dispatch({ type: 'busy', label: null });
        return result;
      } catch (err) {
        dispatch({ type: 'error', message: messageFor(err) });
        return undefined;
      }
    },
    [dispatch],
  );

  const uploadVideo = useCallback(
    async (file: File) => {
      const res = await run('Uploading video', () => api.upload(file));
      if (res) dispatch({ type: 'uploaded', res });
    },
    [run, dispatch],
  );

  const slicePreview = useCallback(async () => {
    if (!state.job) return;
    const { start, end, fps } = state.trim;
    const res = await run('Extracting frames', () =>
      api.preview(state.job!.jobId, { start, end, fps }),
    );
    if (res) dispatch({ type: 'previewed', res });
  }, [run, dispatch, state.job, state.trim]);

  const refreshSlices = useCallback(async () => {
    if (!state.job) return;
    try {
      const res = await api.getJob(state.job.jobId);
      dispatch({
        type: 'setSlices',
        slices: res.slices.map((s) => ({
          sliceId: s.slice_id,
          frameCount: s.frame_count,
          hasPackage: s.has_package,
        })),
      });
    } catch {
      // The SAVED SLICES rail is informational; never block the flow on it.
    }
  }, [dispatch, state.job]);

  const finalizeSlice = useCallback(async () => {
    if (!state.job || !state.preview) return;
    const res = await run('Finalizing slice', () =>
      api.finalize(state.job!.jobId, {
        preview_id: state.preview!.preview_id,
        excluded: [...state.excluded],
      }),
    );
    if (res) {
      dispatch({ type: 'finalized', sliceId: res.slice_id, frames: res.frames });
      dispatch({ type: 'toast', message: `Slice finalized. ${res.count} frames.` });
      // A new durable slice now exists — refresh the SAVED SLICES rail.
      void refreshSlices();
    }
  }, [run, dispatch, state.job, state.preview, state.excluded, refreshSlices]);

  const cropSlice = useCallback(
    async (
      args: { mode: 'auto' } | { mode: 'manual'; box: [number, number, number, number] },
    ) => {
      if (!state.job || !state.sliceId) return;
      const res = await run('Cropping frames', () =>
        api.crop(state.job!.jobId, state.sliceId!, args),
      );
      if (res) {
        dispatch({ type: 'cropped', box: res.crop_box, frames: res.frames });
        dispatch({ type: 'toast', message: 'Crop applied to every frame.' });
      }
    },
    [run, dispatch, state.job, state.sliceId],
  );

  const eraseRegion = useCallback(
    async (box: [number, number, number, number], tier: 'auto' | EraseTier = 'auto') => {
      if (!state.job || !state.sliceId) return;
      const res = await run('Erasing region', () =>
        api.erase(state.job!.jobId, state.sliceId!, { box, tier }),
      );
      if (res) {
        dispatch({ type: 'erased', tier: res.tier_used, frames: res.frames });
        dispatch({ type: 'toast', message: `Region erased. ${res.tier_used} tier.` });
      }
    },
    [run, dispatch, state.job, state.sliceId],
  );

  const loadPackages = useCallback(async () => {
    if (!state.job) return;
    try {
      const res = await api.listPackages(state.job.jobId);
      dispatch({ type: 'setPackages', packages: res.packages });
    } catch {
      // The PACKAGES rail is informational; never block the flow on it.
    }
  }, [dispatch, state.job]);

  const exportPackage = useCallback(
    async (args: { slug?: string; headline?: string; accent?: string }) => {
      if (!state.job || !state.sliceId) return;
      const res = await run('Building package', () =>
        api.buildPackage(state.job!.jobId, state.sliceId!, args),
      );
      if (res) {
        dispatch({ type: 'packaged', res });
        // verify.pass can be false on a 200 — report honestly (API.md §7.3).
        dispatch({
          type: 'toast',
          message: res.verify.pass
            ? 'Package built. All gates passed.'
            : 'Package built, but the quality gate failed.',
        });
        // A new package dir now exists — refresh the PACKAGES rail.
        void loadPackages();
      }
    },
    [run, dispatch, state.job, state.sliceId, loadPackages],
  );

  const loadShare = useCallback(async () => {
    try {
      const res = await api.getShare();
      dispatch({ type: 'share', res });
    } catch {
      // Share URLs are a convenience; never block the flow on them.
    }
  }, [dispatch]);

  /** Open an existing job in the slicer (dashboard card click → GET §5.2). */
  const openJob = useCallback(
    async (jobId: string) => {
      const res = await run('Opening slice', () => api.getJob(jobId));
      if (res) {
        dispatch({ type: 'openedJob', res });
        void loadPackages();
      }
    },
    [run, dispatch, loadPackages],
  );

  /** Delete one built package from the PACKAGES rail (API.md §12.5). */
  const removePackage = useCallback(
    async (packageId: string) => {
      if (!state.job) return;
      const res = await run('Deleting package', () =>
        api.deletePackage(state.job!.jobId, packageId),
      );
      if (res) {
        dispatch({ type: 'toast', message: 'Package deleted.' });
        void loadPackages();
      }
    },
    [run, dispatch, state.job, loadPackages],
  );

  /** Open a SAVED SLICE into the workspace (crop/erase/export operate on it). */
  const selectSlice = useCallback(
    async (sliceId: string) => {
      if (!state.job) return;
      const res = await run('Loading slice', () =>
        api.getSlice(state.job!.jobId, sliceId),
      );
      if (res) {
        dispatch({ type: 'selectedSlice', sliceId: res.slice_id, frames: res.frames });
        dispatch({ type: 'toast', message: `Slice loaded. ${res.count} frames.` });
        void loadPackages();
      }
    },
    [run, dispatch, state.job, loadPackages],
  );

  /** Delete a saved slice from the SAVED SLICES rail. */
  const removeSlice = useCallback(
    async (sliceId: string) => {
      if (!state.job) return;
      const res = await run('Deleting slice', () =>
        api.deleteSlice(state.job!.jobId, sliceId),
      );
      if (res) {
        dispatch({ type: 'removedSlice', sliceId });
        dispatch({ type: 'toast', message: 'Slice deleted.' });
        void refreshSlices();
      }
    },
    [run, dispatch, state.job, refreshSlices],
  );

  return {
    uploadVideo,
    slicePreview,
    finalizeSlice,
    cropSlice,
    eraseRegion,
    exportPackage,
    loadShare,
    loadPackages,
    refreshSlices,
    openJob,
    removePackage,
    selectSlice,
    removeSlice,
  };
}
