import { Data } from "effect";

export type ExecutorSubcommand = Data.TaggedEnum<{
  Help: {};
  Config: {};
  Status: {};
  Reload: {};
  Unknown: { readonly name: string };
}>;

export const { Help, Config, Status, Reload, Unknown } = Data.taggedEnum<ExecutorSubcommand>();

export const executorCommandHelp = [
  "/executor status - show active Executor host status",
  "/executor reload - rebuild the Executor host for this cwd",
  "/executor config - adjust Pi Executor display and render settings",
  "/executor help - show this help",
].join("\n");

const parseToken = (args: string): string =>
  args.trim().split(/\s+/, 1)[0]?.toLowerCase() || "status";

const subcommandByToken = {
  help: Help,
  config: Config,
  settings: Config,
  status: Status,
  reload: Reload,
} as const;

export const parseExecutorSubcommand = (args: string): ExecutorSubcommand => {
  const token = parseToken(args);
  const ctor = subcommandByToken[token as keyof typeof subcommandByToken];
  return ctor ? ctor() : Unknown({ name: token });
};
