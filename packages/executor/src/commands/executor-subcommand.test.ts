import { describe, expect, it } from "vitest";

import {
  Config,
  Help,
  Reload,
  SearchInspect,
  SearchReconcile,
  SearchRebuild,
  SearchStatus,
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
    expect(parseExecutorSubcommand("search")._tag).toBe("SearchStatus");
    expect(parseExecutorSubcommand("search status")._tag).toBe("SearchStatus");
    expect(parseExecutorSubcommand("search reconcile")._tag).toBe("SearchReconcile");
    expect(parseExecutorSubcommand("search rebuild")._tag).toBe("SearchRebuild");
    expect(parseExecutorSubcommand("search inspect github.issues.create")).toEqual(
      SearchInspect({ path: "github.issues.create" }),
    );
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
    expect(SearchStatus()).toEqual({ _tag: "SearchStatus" });
    expect(SearchReconcile()).toEqual({ _tag: "SearchReconcile" });
    expect(SearchRebuild()).toEqual({ _tag: "SearchRebuild" });
  });
});
