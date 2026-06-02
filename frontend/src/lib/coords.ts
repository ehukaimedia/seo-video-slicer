/**
 * coords.ts — screen ↔ source-pixel mapping for crop/erase boxes.
 *
 * Crop and erase POST a box in SOURCE FRAME PIXELS as integers, in-bounds
 * (API.md §7.1/§7.2). A frame is displayed with `object-fit: contain` inside a
 * stage element of a different size, so a drag in screen space must be mapped
 * back through the letterbox to true pixel space. Getting this transform wrong
 * is the likely bug, so it lives in one tested place.
 */

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The on-screen rectangle the frame actually occupies (object-fit: contain). */
export interface DisplayRect {
  /** Offset of the rendered frame inside its container, in CSS px. */
  offsetX: number;
  offsetY: number;
  /** Rendered frame size in CSS px (letterboxed). */
  drawW: number;
  drawH: number;
}

/**
 * Where a `contain`-fitted frame of (natW × natH) lands inside a container of
 * (boxW × boxH). Mirrors the browser's letterbox math so our overlay aligns
 * with the painted pixels exactly.
 */
export function containRect(
  natW: number,
  natH: number,
  boxW: number,
  boxH: number,
): DisplayRect {
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) {
    return { offsetX: 0, offsetY: 0, drawW: boxW, drawH: boxH };
  }
  const scale = Math.min(boxW / natW, boxH / natH);
  const drawW = natW * scale;
  const drawH = natH * scale;
  return {
    offsetX: (boxW - drawW) / 2,
    offsetY: (boxH - drawH) / 2,
    drawW,
    drawH,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Map a drag (two corner points in container-local CSS px) to an integer,
 * in-bounds source-pixel box. Returns null if the box has no area.
 */
export function dragToPixelBox(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  natW: number,
  natH: number,
  rect: DisplayRect,
): PixelBox | null {
  const scaleX = rect.drawW / natW;
  const scaleY = rect.drawH / natH;

  // Container px → frame px (subtract letterbox offset, divide by scale).
  const toFrameX = (cx: number) =>
    clamp((cx - rect.offsetX) / scaleX, 0, natW);
  const toFrameY = (cy: number) =>
    clamp((cy - rect.offsetY) / scaleY, 0, natH);

  const fx0 = toFrameX(p0.x);
  const fy0 = toFrameY(p0.y);
  const fx1 = toFrameX(p1.x);
  const fy1 = toFrameY(p1.y);

  const x = Math.round(Math.min(fx0, fx1));
  const y = Math.round(Math.min(fy0, fy1));
  const w = Math.round(Math.abs(fx1 - fx0));
  const h = Math.round(Math.abs(fy1 - fy0));

  if (w < 1 || h < 1) return null;
  // Re-clamp width/height so x+w and y+h never exceed the source bounds.
  return {
    x,
    y,
    w: Math.min(w, natW - x),
    h: Math.min(h, natH - y),
  };
}

/** Inverse: a source-pixel box → an overlay rectangle in container CSS px. */
export function pixelBoxToOverlay(
  box: PixelBox,
  natW: number,
  natH: number,
  rect: DisplayRect,
): { left: number; top: number; width: number; height: number } {
  const scaleX = rect.drawW / natW;
  const scaleY = rect.drawH / natH;
  return {
    left: rect.offsetX + box.x * scaleX,
    top: rect.offsetY + box.y * scaleY,
    width: box.w * scaleX,
    height: box.h * scaleY,
  };
}
