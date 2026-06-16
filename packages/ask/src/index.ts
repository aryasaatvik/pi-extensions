import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeAskTool } from "./tools/ask.ts";

export default function piAsk(pi: ExtensionAPI): void {
  pi.registerTool(makeAskTool());
}
