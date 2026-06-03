import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// A tiny, fully self-contained hero motion: a brand-neutral near-black stage
// with an orbiting accent ring and a pulsing wordmark. NO external assets, NO
// network fonts, NO image/url() references — everything is drawn from numbers
// so the render works on a clean clone and the sliced package stays
// self-contained (slicer gate G3: zero external requests).
//
// The motion is built to LOOP cleanly: every animated value returns to its
// frame-0 state at the final frame, so the seo-video-slicer loop.webp has no
// visible seam.

const STAGE = "#0a0a0c"; // near-black "Dark Instrument" stage
const ACCENT = "#5eead4"; // teal accent (drawn, not loaded)
const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const HeroLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  // Loop phase in [0, 1): 0 at the first frame, wrapping back to 0 at the end.
  const phase = (frame % durationInFrames) / durationInFrames;
  const angle = phase * Math.PI * 2; // one full revolution per loop

  const cx = width / 2;
  const cy = height / 2;
  const orbitR = Math.min(width, height) * 0.22;

  // Orbiting dot — returns to its start because angle wraps a full circle.
  const dotX = cx + Math.cos(angle) * orbitR;
  const dotY = cy + Math.sin(angle) * orbitR;

  // Pulsing scale via a full sine cycle (seamless at the wrap point).
  const pulse = 1 + Math.sin(angle) * 0.06;

  // Ring sweep: a conic-style highlight rotated by the same angle.
  const ringRotate = (angle * 180) / Math.PI;

  return (
    <AbsoluteFill style={{ backgroundColor: STAGE }}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Accent ring */}
        <div
          style={{
            position: "absolute",
            width: orbitR * 2.4,
            height: orbitR * 2.4,
            borderRadius: "50%",
            border: `2px solid rgba(94, 234, 212, 0.25)`,
            transform: `rotate(${ringRotate}deg)`,
          }}
        />
        {/* Orbiting dot */}
        <div
          style={{
            position: "absolute",
            left: dotX - 9,
            top: dotY - 9,
            width: 18,
            height: 18,
            borderRadius: "50%",
            backgroundColor: ACCENT,
            boxShadow: `0 0 24px 4px rgba(94, 234, 212, 0.55)`,
          }}
        />
        {/* Wordmark */}
        <div
          style={{
            transform: `scale(${pulse})`,
            color: "#f4f4f5",
            fontFamily: SYSTEM_FONT,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -1.5,
            textAlign: "center",
            opacity: interpolate(
              Math.sin(angle),
              [-1, 1],
              [0.82, 1],
            ),
          }}
        >
          seo-video-slicer
          <div
            style={{
              marginTop: 12,
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: 0.5,
              color: ACCENT,
            }}
          >
            render &rarr; slice &rarr; embed
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
