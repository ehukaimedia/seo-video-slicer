/**
 * Dashboard — the app home / library (task A). Lists every job (GET /api/jobs,
 * API.md §12.1), with stat cards, a responsive job grid, per-card Rename/Delete
 * menus (PUT/DELETE §12.2/§12.3), and a dashed "+ New Slice" card. A card opens
 * that job in the slicer (GET §5.2 via openJob); New Slice enters the uploader.
 *
 * Dark Electric-Blue studio: glass-card surfaces, hairline borders, the one
 * accent, system fonts. No light surfaces, no serif, no icon library.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api/client';
import type { JobSummary } from '../api/types';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';
import { ShareToggle } from './ShareToggle';
import {
  ChevronRightIcon,
  FilmIcon,
  GridIcon,
  MoreIcon,
  PenIcon,
  PlusIcon,
  TrashIcon,
} from './Icons';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function Dashboard() {
  const { dispatch } = useStore();
  const { openJob } = useActions();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listJobs();
      setJobs(res.jobs);
    } catch {
      // An empty / unreachable list simply shows the empty state.
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close the open card menu on any outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const packageTotal = jobs.reduce((n, j) => n + j.package_count, 0);

  async function saveTitle(id: string) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await api.renameJob(id, title);
      setJobs((prev) => prev.map((j) => (j.job_id === id ? { ...j, title } : j)));
      dispatch({ type: 'toast', message: 'Slice renamed.' });
    } catch {
      dispatch({ type: 'error', message: 'Could not rename the slice.' });
    }
  }

  async function removeJob(id: string) {
    setMenuId(null);
    try {
      await api.deleteJob(id);
      setJobs((prev) => prev.filter((j) => j.job_id !== id));
      dispatch({ type: 'toast', message: 'Slice deleted.' });
    } catch {
      dispatch({ type: 'error', message: 'Could not delete the slice.' });
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <span className="pulse-dot" aria-hidden="true" />
          <span className="topbar-status">Slicer Ready</span>
        </div>
        <div className="topbar-right">
          <ShareToggle />
          <button
            className="btn-primary"
            onClick={() => dispatch({ type: 'newSlice' })}
          >
            <PlusIcon size={16} /> New Slice
          </button>
        </div>
      </div>

      <main className="dash fade-in">
        <header className="dash-hero">
          <span className="ds-eyebrow">SEO Video Slicer</span>
          <h1>SEO Video Slicer.</h1>
          <p className="ds-lead">
            Turn a short clip into a drop-in WebP scroll package: trimmed frames,
            a self-contained player, a manifest, and a verify gate. Lean,
            local-first, and ready to drop into any repo.
          </p>
        </header>

        <section className="dash-stats">
          <div className="stat-card">
            <span className="stat-card-label">Packages</span>
            <span className="stat-card-value">{packageTotal}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">Engine</span>
            <span className="stat-card-value ds-accent" style={{ fontSize: '1.05rem' }}>
              ffmpeg + OpenCV
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">Output</span>
            <span className="stat-card-value" style={{ fontSize: '1.05rem' }}>
              WebP Scroll Package
            </span>
          </div>
        </section>

        <section>
          <div className="dash-section-head">
            <span className="ds-accent" aria-hidden="true">
              <GridIcon size={18} />
            </span>
            <h2>Library</h2>
          </div>

          <div className="dash-grid">
            {jobs.map((job) => (
              <div
                key={job.job_id}
                className="glass-card job-card"
                onClick={() => {
                  if (editingId === job.job_id) return;
                  void openJob(job.job_id);
                }}
              >
                <div className="job-card-thumb">
                  {job.thumb_url ? (
                    <img src={job.thumb_url} alt={job.title} loading="lazy" />
                  ) : (
                    <div className="job-card-thumb-empty">
                      <FilmIcon size={32} />
                    </div>
                  )}
                  <span className="badge job-card-id">
                    {job.job_id.slice(0, 8)}
                  </span>
                </div>

                <div className="job-card-body">
                  {editingId === job.job_id ? (
                    <form
                      onClick={(e) => e.stopPropagation()}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveTitle(job.job_id);
                      }}
                    >
                      <input
                        autoFocus
                        className="input-field"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => void saveTitle(job.job_id)}
                      />
                    </form>
                  ) : (
                    <span className="job-card-title">{job.title}</span>
                  )}
                  <span className="job-card-meta">
                    Created {formatDate(job.created_at)}
                  </span>
                  <div className="job-card-tags">
                    <span className="badge">{job.slice_count} slices</span>
                    <span className="badge">{job.package_count} pkg</span>
                    {job.resolution ? (
                      <span className="badge">{job.resolution}</span>
                    ) : null}
                  </div>

                  <div className="job-card-foot">
                    <span className="ds-link">
                      Open <ChevronRightIcon size={14} />
                    </span>
                    <div
                      ref={menuId === job.job_id ? menuRef : null}
                      style={{ position: 'relative' }}
                    >
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Slice options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId(menuId === job.job_id ? null : job.job_id);
                        }}
                      >
                        <MoreIcon size={16} />
                      </button>
                      {menuId === job.job_id ? (
                        <div className="menu-pop" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              setMenuId(null);
                              setEditingId(job.job_id);
                              setEditTitle(job.title);
                            }}
                          >
                            <PenIcon size={14} /> Rename
                          </button>
                          <div className="menu-divider" />
                          <button
                            type="button"
                            className="menu-item-danger"
                            onClick={() => void removeJob(job.job_id)}
                          >
                            <TrashIcon size={14} /> Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="job-card-empty"
              onClick={() => dispatch({ type: 'newSlice' })}
            >
              <PlusIcon size={28} />
              <span className="ds-title" style={{ fontSize: '1rem' }}>
                New Slice
              </span>
              <span className="ds-supporting">
                Import a clip to start a new package.
              </span>
            </button>

            {jobs.length === 0 ? (
              <div className="dash-empty">
                <p className="ds-supporting">
                  No slices yet. Import your first clip to build a WebP package.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
