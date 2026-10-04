import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/extension.ts"],
  format: "esm",
  platform: "node",
  fixedExtension: false,
  dts: true,
  clean: true,
  deps: {
    neverBundle: [/^effect(\/|$)/, /^typebox(\/|$)/, /^@earendil-works\//],
  },
});
