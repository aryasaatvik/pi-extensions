import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

export interface ResolvedExecutorScope {
  readonly scopeDir: string;
  readonly scopeId: string;
}

export const resolveExecutorScope = (cwd: string): ResolvedExecutorScope => {
  const scopeDir = resolve(cwd);
  const folder = basename(scopeDir) || scopeDir;
  const hash = createHash("sha256").update(scopeDir).digest("hex").slice(0, 8);

  return {
    scopeDir,
    scopeId: `${folder}-${hash}`,
  };
};
