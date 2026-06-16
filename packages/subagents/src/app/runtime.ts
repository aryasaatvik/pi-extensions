import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ManagedRuntime } from "effect";

import { makeAppLayer, type AppServices } from "./layer.ts";

export const makeRuntime = (pi: ExtensionAPI): ManagedRuntime.ManagedRuntime<AppServices, never> =>
  ManagedRuntime.make(makeAppLayer(pi));
