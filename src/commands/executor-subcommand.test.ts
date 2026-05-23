import { describe, expect, it } from "vitest";

import {
  Config,
  Help,
  Reload,
  Status,
  Unknown,
  parseExecutorSubcommand,
} from "./executor-subcommand.ts";

describe("parseExecutorSubcommand", () => {
  it("parses known tokens", () => {
    expect(parseExecutorSubcommand("")._tag).toBe("Status");
    expect(parseExecutorSubcommand("status")._tag).toBe("Status");
    expect(parseExecutorSubcommand("reload")._tag).toBe("Reload");
    expect(parseExecutorSubcommand("help")._tag).toBe("Help");
    expect(parseExecutorSubcommand("config")._tag).toBe("Config");
    expect(parseExecutorSubcommand("settings")._tag).toBe("Config");
  });

  it("returns Unknown for unrecognized tokens", () => {
    const subcommand = parseExecutorSubcommand("nope");
    expect(subcommand).toEqual(Unknown({ name: "nope" }));
  });

  it("exports tagged constructors", () => {
    expect(Help()).toEqual({ _tag: "Help" });
    expect(Config()).toEqual({ _tag: "Config" });
    expect(Status()).toEqual({ _tag: "Status" });
    expect(Reload()).toEqual({ _tag: "Reload" });
  });
});
