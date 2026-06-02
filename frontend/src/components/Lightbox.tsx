/**
 * Lightbox — the deepest recess for pixel-peeping a single frame (DESIGN §5).
 * Stage-deep scrim, crisp-edges rendering, Escape to close. Scoped to the dark
 * stage palette; the only color is the frame itself.
 */
import { useEffect } from 'react';
import { CloseIcon } from './Icons';

interface Props {
  src: string;
  label: string;
  onClose: () => void;
}

export function Lightbox({ src, label, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="ds-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Frame ${label}`}
      onClick={onClose}
    >
      <button className="ds-lightbox-close" aria-label="Close" onClick={onClose}>
        <CloseIcon size={16} />
      </button>
      <div onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={`Frame ${label}`} />
        <p className="ds-lightbox-meta">{label}</p>
      </div>
    </div>
  );
}
