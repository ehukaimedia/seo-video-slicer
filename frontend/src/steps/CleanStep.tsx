/**
 * CleanStep — Step 04. Two clean tools operating on the finalized slice in place
 * (spec §5.5/§6): CROP (auto contour, or draw a manual box) and ERASE (drag a
 * box → two-tier inpaint, with the tier_used badge). Both POST source-pixel
 * boxes via lib/coords. The slice filmstrip below reflects the mutated bytes
 * (the `?v` cache-buster forces a re-fetch). "To export" advances to packaging.
 *
 * Crop/erase require a slice_id, which only exists after finalize — this step is
 * unreachable until then (gated by StepRail + App routing).
 */
import { useEffect, useState } from 'react';
import type { FrameRef } from '../api/types';
import type { PixelBox } from '../lib/coords';
import { useActions } from '../state/actions';
import { useStore } from '../state/store';
import { BoxDrawer } from '../components/BoxDrawer';
import { Filmstrip } from '../components/Filmstrip';
import { Lightbox } from '../components/Lightbox';

type ToolMode = 'crop' | 'erase';

export function CleanStep() {
  const { state, dispatch } = useStore();
  const { cropSlice, eraseRegion } = useActions();
  const [tool, setTool] = useState<ToolMode>('crop');
  const [cropBox, setCropBox] = useState<PixelBox | null>(null);
  const [eraseBox, setEraseBox] = useState<PixelBox | null>(null);
  const [zoom, setZoom] = useState<FrameRef | null>(null);
  // Track the actual rendered frame dimensions; crop changes resolution, so we
  // read it from the live image rather than the original source meta.
  const [natW, setNatW] = useState(state.job?.width ?? 1280);
  const [natH, setNatH] = useState(state.job?.height ?? 720);

  const frames = state.sliceFrames;
  const firstFrame = frames[0];
  const busy = state.busy !== null;

  // Refresh natural dims whenever the lead frame url changes (post crop/erase).
  // This is a side effect (loads an Image, sets state on load), so it is a
  // useEffect, not a useMemo. crop changes resolution, so we read the live image.
  const leadUrl = firstFrame?.url ?? '';
  useEffect(() => {
    if (!leadUrl) return;
    const img = new Image();
    img.onload = () => {
      setNatW(img.naturalWidth);
      setNatH(img.naturalHeight);
    };
    img.src = leadUrl;
  }, [leadUrl]);

  if (!firstFrame) return null;

  const box = tool === 'crop' ? cropBox : eraseBox;
  const setBox = tool === 'crop' ? setCropBox : setEraseBox;

  return (
    <div className="stack">
      <div className="step-head">
        <span className="ds-eyebrow">Step 04</span>
        <h1 className="ds-headline">Clean</h1>
        <p className="ds-lead">
          Tighten the frame and remove what should not ship. Crop and erase apply
          to every frame in place. Decisions are made on the dark stage so edges
          and color read true.
        </p>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <span className="ds-eyebrow">Sequence Utilities</span>
        <div className="utility-bar" role="tablist" aria-label="Clean tools">
          <button
            className="fps-chip"
            role="tab"
            aria-selected={tool === 'crop'}
            data-active={tool === 'crop'}
            onClick={() => setTool('crop')}
          >
            Manual Crop
          </button>
          <button
            className="fps-chip"
            role="tab"
            aria-selected={tool === 'erase'}
            data-active={tool === 'erase'}
            onClick={() => setTool('erase')}
          >
            Erase Region
          </button>
        </div>
      </div>

      <div className="ds-stage stack">
        <div className="row-between">
          <span className="ds-stage-timecode">
            {frames.length} frames · {natW}×{natH}
          </span>
          <span className="ds-stage-timecode">
            {tool === 'crop'
              ? cropBox
                ? `crop box ${cropBox.x},${cropBox.y} ${cropBox.w}×${cropBox.h}`
                : 'draw a crop box, or use auto'
              : eraseBox
                ? `erase box ${eraseBox.x},${eraseBox.y} ${eraseBox.w}×${eraseBox.h}`
                : 'drag the region to erase'}
          </span>
        </div>
        <BoxDrawer
          src={firstFrame.url}
          natW={natW}
          natH={natH}
          box={box}
          onBox={setBox}
        />
      </div>

      {tool === 'crop' ? (
        <div className="actions">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void cropSlice({ mode: 'auto' })}
          >
            Auto crop
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !cropBox}
            onClick={() =>
              cropBox &&
              void cropSlice({
                mode: 'manual',
                box: [cropBox.x, cropBox.y, cropBox.w, cropBox.h],
              })
            }
          >
            Apply drawn crop
          </button>
          {state.lastCropBox ? (
            <span className="ds-pill">
              cropped {state.lastCropBox[2]}×{state.lastCropBox[3]}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="actions">
          <button
            className="btn-primary"
            disabled={busy || !eraseBox}
            onClick={() =>
              eraseBox &&
              void eraseRegion([eraseBox.x, eraseBox.y, eraseBox.w, eraseBox.h])
            }
          >
            Erase region
          </button>
          {state.lastEraseTier ? (
            <span className="ds-pill" data-tone="pass">
              tier_used: {state.lastEraseTier}
            </span>
          ) : (
            <span className="ds-supporting">
              Two-tier inpaint, auto-selected. The badge reports the tier that ran.
            </span>
          )}
        </div>
      )}

      <Filmstrip
        frames={frames}
        activeName={null}
        onActivate={() => {}}
        onZoom={setZoom}
      />

      <div className="actions">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => dispatch({ type: 'goto', step: 'export' })}
        >
          To export
        </button>
        <span className="ds-supporting">
          Cleaning is optional. Move to export when the frames are ready.
        </span>
      </div>

      {zoom ? (
        <Lightbox
          src={zoom.url}
          label={zoom.name.replace(/\.\w+$/, '')}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  );
}
