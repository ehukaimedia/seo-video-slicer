/**
 * BoxDrawer — draw a rectangle over a frame on the dark stage and emit it in
 * SOURCE-PIXEL coordinates (integers, in-bounds) for crop-manual and erase
 * (API.md §7.1/§7.2). The frame is shown with object-fit: contain, so drags are
 * mapped back through the letterbox via lib/coords. The committed box is drawn
 * back as an overlay so the user sees exactly what will be sent.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  containRect,
  dragToPixelBox,
  pixelBoxToOverlay,
  type DisplayRect,
  type PixelBox,
} from '../lib/coords';

interface Props {
  /** Frame image url (verbatim, may carry ?v). */
  src: string;
  natW: number;
  natH: number;
  box: PixelBox | null;
  onBox: (box: PixelBox | null) => void;
}

export function BoxDrawer({ src, natW, natH, box, onBox }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DisplayRect | null>(null);
  const [dragRect, setDragRect] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const measure = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect(containRect(natW, natH, r.width, r.height));
  }, [natW, natH]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const el = hostRef.current!;
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!rect) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = localPoint(e.clientX, e.clientY);
    setDragRect(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current || !rect) return;
    const p = localPoint(e.clientX, e.clientY);
    const s = dragStart.current;
    setDragRect({
      left: Math.min(s.x, p.x),
      top: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragStart.current || !rect) return;
    const p = localPoint(e.clientX, e.clientY);
    const pixel = dragToPixelBox(dragStart.current, p, natW, natH, rect);
    dragStart.current = null;
    setDragRect(null);
    onBox(pixel);
  };

  const committed =
    box && rect ? pixelBoxToOverlay(box, natW, natH, rect) : null;

  return (
    <div
      ref={hostRef}
      className="ds-stage-preview draw-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        src={src}
        alt="Frame under edit"
        onLoad={measure}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />
      {dragRect ? <div className="draw-overlay" style={dragRect} /> : null}
      {committed && !dragRect ? (
        <div className="draw-overlay" style={committed} />
      ) : null}
    </div>
  );
}
