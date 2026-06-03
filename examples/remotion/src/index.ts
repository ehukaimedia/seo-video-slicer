// Remotion entry point. `registerRoot` tells the renderer where the
// compositions live; `npx remotion render <id> ...` then renders one by id.
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
