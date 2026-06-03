// Remotion config — applies to `remotion studio` and `remotion render`.
//
// We pin a PNG image SEQUENCE (one file per frame) because the seo-video-slicer
// ingests a frames directory, not an MP4. PNG keeps alpha and avoids inter-frame
// compression artifacts before the slicer re-encodes to WebP.
//
// `setImageSequencePattern("frame_[frame].[ext]")` makes the renderer emit
// zero-padded `frame_0000.png … frame_0089.png`, which the slicer ingests
// cleanly. If you DROP this line, Remotion's default sequence naming is
// `element-NNNN.png` — the slicer's `convert_frames_to_webp` handles BOTH
// (it sorts numerically by the trailing integer and renumbers to contiguous
// `frame_NNN.webp`), so either pattern works. We pin it for the clean happy path.
//
// Flags on the CLI (`--sequence --image-format=png`) also carry these settings;
// config + flags agree, and the CLI wins if they ever differ.
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setImageSequence(true);
Config.setImageSequencePattern("frame_[frame].[ext]");
