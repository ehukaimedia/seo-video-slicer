/**
 * ExportStep — Step 05. The dark EXPORT PANEL: a panel-deep glass-card listing
 * what ships (frame count, weight, lane, gates), the white "Export Package" CTA,
 * and on success the verify gates, a download button, and the share URLs
 * (GET /api/share). The new package also appears in the sidebar PACKAGES rail.
 *
 * CONTRACT-CRITICAL: POST …/package returns HTTP 200 even when the gate FAILS
 * (API.md §7.3). Success is decided by `pkg.verify.pass`, never the HTTP status.
 * When it fails, download_url/preview_url are null — no download button, the
 * failing gates are shown instead. The Electric-Blue glow lights only the ready CTA.
 */
import { useEffect, useState } from 'react';
import { mb } from '../lib/format';
import { slugFromFilename } from '../lib/format';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';

export function ExportStep() {
  const { state, dispatch } = useStore();
  const { exportPackage, loadShare } = useActions();
  const job = state.job;
  const pkg = state.pkg;
  const busy = state.busy !== null;

  const [slug, setSlug] = useState(() =>
    job ? slugFromFilename(job.filename) : 'hero-loop',
  );

  // Share URLs are a handoff convenience; load them once on entering export.
  useEffect(() => {
    if (!state.share) void loadShare();
  }, [state.share, loadShare]);

  if (!job || !state.sliceId) return null;

  const frameCount = state.sliceFrames.length;
  const built = pkg !== null;
  const passed = pkg?.verify.pass === true;
  const ready = !built; // CTA earns the Accent Glow when poised to build

  return (
    <div className="stack">
      <div className="step-head">
        <span className="ds-eyebrow">Step 05</span>
        <h1 className="ds-headline">Export</h1>
        <p className="ds-lead">
          Assemble the contract package: frames, a self-contained scroll player,
          a manifest, a README, and the verify gate. The package is the product.
          Drop the folder into any repo and tell the model to use it.
        </p>
      </div>

      <div className="ds-export-panel" data-ready={ready}>
        <span className="ds-eyebrow">What ships</span>
        <ul className="include-list">
          <li className="include-row">
            <span className="label">Frames</span>
            <span className="ds-export-stat">{frameCount} WebP, contiguous</span>
          </li>
          <li className="include-row">
            <span className="label">Player</span>
            <span className="ds-export-stat">index.html, scroll-driven, zero requests</span>
          </li>
          <li className="include-row">
            <span className="label">Manifest &amp; gate</span>
            <span className="ds-export-stat">manifest.json, verify.mjs (G1–G7)</span>
          </li>
          <li className="include-row">
            <span className="label">Docs</span>
            <span className="ds-export-stat">README.md, PROMPT.md</span>
          </li>
          {built ? (
            <li className="include-row">
              <span className="label">Weight</span>
              <span className="ds-export-stat">
                {mb(pkg!.weight_mb)} · lane {pkg!.lane}
              </span>
            </li>
          ) : null}
        </ul>

        <div className="field" style={{ maxWidth: 360, marginBottom: 24 }}>
          <label htmlFor="slug">Package id</label>
          <input
            id="slug"
            className="input-field"
            value={slug}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '-')
                  .slice(0, 64),
              )
            }
          />
        </div>

        <div className="actions">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void exportPackage({ slug })}
          >
            {busy ? 'Building…' : built ? 'Rebuild Package' : 'Export Package'}
          </button>
          <button
            className="ds-link"
            onClick={() => dispatch({ type: 'goto', step: 'clean' })}
          >
            Back to clean
          </button>
        </div>

        {built ? (
          <div style={{ marginTop: 32 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="ds-eyebrow">Verify gate</span>
              <span className="ds-pill" data-tone={passed ? 'pass' : 'fail'}>
                {passed ? 'PASS' : 'FAIL'}
              </span>
            </div>
            <ul className="gate-list">
              {pkg!.verify.gates.map((g) => (
                <li className="gate-row" key={g.id}>
                  <span className="gate-mark" data-pass={g.pass}>
                    {g.pass ? 'PASS' : 'FAIL'} {g.id}
                  </span>
                  <span>{g.detail}</span>
                </li>
              ))}
            </ul>

            {passed && pkg!.download_url ? (
              <div className="actions" style={{ marginTop: 16 }}>
                <a className="btn-primary" href={pkg!.download_url} download>
                  Download zip
                </a>
                {pkg!.preview_url ? (
                  <a
                    className="ds-link"
                    href={pkg!.preview_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the player
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="ds-supporting" style={{ marginTop: 16, color: 'var(--danger)' }}>
                The gate failed, so the package is not offered for download. Fix
                the failing gate above (usually frame count over the cap), then
                rebuild.
              </p>
            )}

            {passed && state.share ? (
              <div className="share-list">
                <span className="ds-eyebrow">Reachable at</span>
                <span>local: {state.share.local}</span>
                {state.share.lan ? <span>lan: {state.share.lan}</span> : null}
                {state.share.tailscale ? (
                  <span>tailscale: {state.share.tailscale}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
