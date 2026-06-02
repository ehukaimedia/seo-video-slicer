/**
 * Sidebar — the slicer's left rail (task B): SAVED SLICES and PACKAGES lists.
 * Slices come from the open job (GET /api/jobs/{id} §5.2); packages from GET
 * /api/jobs/{id}/packages (§12.4). Each package row carries a thumbnail, frame
 * count, a WEBP badge, a download icon-btn (per-package zip; null when the gate
 * failed) and a danger delete icon-btn (DELETE §12.5). This is the package
 * management surface the user asked for.
 */
import { useEffect } from 'react';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';
import {
  DownloadIcon,
  FilmIcon,
  LayersIcon,
  PackageIcon,
  TrashIcon,
} from './Icons';

export function Sidebar() {
  const { state } = useStore();
  const { loadPackages, removePackage, selectSlice, removeSlice } = useActions();

  // Keep the PACKAGES rail fresh when the job changes.
  useEffect(() => {
    if (state.job) void loadPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.job?.jobId]);

  return (
    <aside className="sidebar">
      <section>
        <div className="sidebar-section-head">
          <LayersIcon size={14} /> Saved Slices
          <span className="sidebar-count">{state.slices.length}</span>
        </div>
        <div className="rail-list">
          {state.slices.length === 0 ? (
            <div className="rail-empty">No slices yet. Finalize a trim.</div>
          ) : (
            state.slices.map((s) => {
              const active = s.sliceId === state.sliceId;
              return (
                <div
                  key={s.sliceId}
                  className="rail-card rail-card-clickable"
                  data-active={active}
                  role="button"
                  tabIndex={0}
                  title="Open this slice — crop, erase, and export it"
                  onClick={() => void selectSlice(s.sliceId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void selectSlice(s.sliceId);
                    }
                  }}
                >
                  <div className="rail-thumb rail-thumb-empty">
                    <FilmIcon size={20} />
                  </div>
                  <div className="rail-body">
                    <span className="rail-title">{s.sliceId}</span>
                    <div className="rail-meta">
                      <span className="rail-frames">{s.frameCount} frames</span>
                      {s.hasPackage ? <span className="badge">PKG</span> : null}
                    </div>
                  </div>
                  <div className="rail-actions">
                    <button
                      className="icon-btn-danger"
                      aria-label="Delete slice"
                      title="Delete slice"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeSlice(s.sliceId);
                      }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <div className="sidebar-section-head">
          <PackageIcon size={14} /> Packages
          <span className="sidebar-count">{state.packages.length}</span>
        </div>
        <div className="rail-list">
          {state.packages.length === 0 ? (
            <div className="rail-empty">No packages built yet.</div>
          ) : (
            state.packages.map((p) => (
              <div key={p.package_id} className="rail-card">
                {p.thumb_url ? (
                  <img className="rail-thumb" src={p.thumb_url} alt={p.package_id} />
                ) : (
                  <div className="rail-thumb rail-thumb-empty">
                    <PackageIcon size={20} />
                  </div>
                )}
                <div className="rail-body">
                  <span className="rail-title">{p.package_id}</span>
                  <div className="rail-meta">
                    <span className="rail-frames">{p.frame_count} frames</span>
                    <span className="badge">WEBP</span>
                  </div>
                </div>
                <div className="rail-actions">
                  {p.download_url ? (
                    <a
                      className="icon-btn"
                      href={p.download_url}
                      download
                      aria-label="Download package"
                    >
                      <DownloadIcon size={14} />
                    </a>
                  ) : (
                    <button
                      className="icon-btn"
                      disabled
                      title="Gate failed — no zip"
                      aria-label="Download unavailable"
                    >
                      <DownloadIcon size={14} />
                    </button>
                  )}
                  <button
                    className="icon-btn-danger"
                    aria-label="Delete package"
                    onClick={() => void removePackage(p.package_id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}
