/**
 * Filmstrip — a responsive grid of frame thumbnails on the dark stage. Each
 * thumb has a corner check-badge toggle: a success-green check when kept, hollow
 * when excluded. The active thumb is ringed with the accent; excluded thumbs
 * desaturate and strike their index. Clicking the image opens the lightbox.
 *
 * IMPORTANT: image keys/srcs use the frame `url` VERBATIM, including any
 * `?v=<mtime>` cache-buster (API.md §3), so crop/erase re-fetch fresh bytes.
 */
import type { FrameRef } from '../api/types';
import { CheckIcon } from './Icons';

interface Props {
  frames: FrameRef[];
  activeName: string | null;
  /** Bare basenames marked excluded. Pass null to disable the toggle (slice view). */
  excluded?: Set<string>;
  onActivate: (name: string) => void;
  onToggleExclude?: (name: string) => void;
  onZoom: (frame: FrameRef) => void;
}

export function Filmstrip({
  frames,
  activeName,
  excluded,
  onActivate,
  onToggleExclude,
  onZoom,
}: Props) {
  return (
    <div className="ds-filmstrip" role="list" aria-label="Frames">
      {frames.map((frame) => {
        const isExcluded = excluded?.has(frame.name) ?? false;
        const isActive = activeName === frame.name;
        return (
          <div
            key={frame.url}
            role="listitem"
            className="ds-filmstrip-thumb"
            data-active={isActive}
            data-excluded={isExcluded}
            tabIndex={0}
            aria-label={`${frame.name}${isExcluded ? ', excluded' : ''}`}
            onClick={() => {
              onActivate(frame.name);
              onZoom(frame);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onActivate(frame.name);
                onZoom(frame);
              }
            }}
          >
            <img src={frame.url} alt={frame.name} loading="lazy" />
            <span className="ds-filmstrip-index">{frame.name.replace(/\.\w+$/, '')}</span>
            {onToggleExclude ? (
              <button
                type="button"
                className="ds-exclude-toggle"
                aria-label={isExcluded ? `Keep ${frame.name}` : `Exclude ${frame.name}`}
                aria-pressed={!isExcluded}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExclude(frame.name);
                }}
              >
                {!isExcluded ? <CheckIcon size={12} /> : null}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
