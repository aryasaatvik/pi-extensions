import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type PromptChoice = "once" | "session" | "always" | "deny";

const YES = "Yes";
const SESSION = "Yes, allow for the rest of this session";
const ALWAYS = "Yes, always (save to Pi permissions)";
const NO = "No";

/** Show the approval prompt for a gated tool call and map the choice. */
export async function promptForTool(ctx: ExtensionContext, title: string): Promise<PromptChoice> {
  const choice = await ctx.ui.select(title, [YES, SESSION, ALWAYS, NO]);
  switch (choice) {
    case YES:
      return "once";
    case SESSION:
      return "session";
    case ALWAYS:
      return "always";
    default:
      return "deny";
  }
}
