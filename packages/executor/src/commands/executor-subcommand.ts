import { Data } from "effect";

export type ExecutorSubcommand = Data.TaggedEnum<{
  Help: {};
  Config: {};
  Status: {};
  Reload: {};
  SearchStatus: {};
  SearchReconcile: {};
  SearchRebuild: {};
  SearchInspect: { readonly path: string };
  Unknown: { readonly name: string };
}>;

export const {
  Help,
  Config,
  Status,
  Reload,
  SearchStatus,
  SearchReconcile,
  SearchRebuild,
  SearchInspect,
  Unknown,
} = Data.taggedEnum<ExecutorSubcommand>();

export const executorCommandHelp = [
  "/executor status - show active Executor host status",
  "/executor reload - rebuild the Executor host for this cwd",
  "/executor search status - show search index status",
  "/executor search reconcile - incrementally update the search index for this cwd",
  "/executor search rebuild - rebuild the search index for this cwd",
  "/executor search inspect <tool-path> - show indexed text for one tool",
  "/executor config - adjust Pi Executor display and render settings",
  "/executor help - show this help",
].join("\n");

const subcommandByToken = {
  help: Help,
  config: Config,
  settings: Config,
  status: Status,
  reload: Reload,
} as const;

export const parseExecutorSubcommand = (args: string): ExecutorSubcommand => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const token = tokens[0]?.toLowerCase() || "status";
  if (token === "search") {
    const action = tokens[1]?.toLowerCase() || "status";
    if (action === "status") return SearchStatus();
    if (action === "reconcile") return SearchReconcile();
    if (action === "rebuild") return SearchRebuild();
    if (action === "inspect" && tokens[2]) return SearchInspect({ path: tokens[2] });
    return Unknown({ name: tokens.slice(0, 2).join(" ") || "search" });
  }
  const ctor = subcommandByToken[token as keyof typeof subcommandByToken];
  return ctor ? ctor() : Unknown({ name: token });
};
