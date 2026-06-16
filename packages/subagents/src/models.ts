import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const formatModelId = (model: Model<any>): string => `${model.provider}/${model.id}`;

/**
 * A curated short list of model ids to suggest for the `task` tool's `model`
 * override. Pi has no first-class "scoped models" concept exposed to extensions,
 * so we use the registry's available models (those with configured auth) — the
 * de-facto curated subset — and prioritize the current model and its provider.
 */
export function curatedModelIds(
  registry: ModelRegistry,
  current: Model<any> | undefined,
  limit = 5,
): string[] {
  const available = registry.getAvailable();
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (model: Model<any>): void => {
    const id = formatModelId(model);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };

  if (current) push(current);
  if (current) for (const model of available) if (model.provider === current.provider) push(model);
  for (const model of available) push(model);

  return ids.slice(0, limit);
}
