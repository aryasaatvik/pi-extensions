import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/extension.ts"],
  format: "esm",
  platform: "node",
  fixedExtension: false,
  // TypeScript 7 has no classic compiler API, and Effect service classes
  // (`extends Context.Service(...)`) rule out `isolatedDeclarations`. Declaration
  // emit therefore goes through the TypeScript Go API, which first ships in 7.1.
  dts: {
    generator: "tsgo",
    tsgo: { moduleUrl: import.meta.resolve("typescript-next") },
  },
  clean: true,
  deps: {
    neverBundle: [/^effect(\/|$)/, /^typebox(\/|$)/, /^@earendil-works\//],
  },
});
