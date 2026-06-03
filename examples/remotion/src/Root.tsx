import { Composition } from "remotion";
import { HeroLoop } from "./HeroLoop";

// The composition id ("HeroLoop") is the FIRST positional arg to
// `npx remotion render HeroLoop out/ ...` — keep this name and the
// Makefile's render target in sync.
//
// Frame budget: durationInFrames stays well under the slicer's hard cap of
// 200 frames (verify.mjs G7 hard-fails > 200). 90 frames @ 30 fps = 3.0 s of
// source motion; the slicer re-times playback with its own `--fps` (e.g. 12),
// which is independent of this render fps.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HeroLoop"
      component={HeroLoop}
      durationInFrames={90}
      fps={30}
      width={1280}
      height={720}
    />
  );
};
