import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  type ExtensionUIContext,
  ModelRegistry,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { AgentConfig } from "../src/agents/discovery.ts";
import { capBytes, runSubagent, unknownToolNames } from "../src/services/spawn.ts";

const def = (tools?: string[]): AgentConfig => ({
  name: "a",
  description: "d",
  tools,
  systemPrompt: "",
  source: "project",
});

describe("capBytes (output cap)", () => {
  it("returns the text unchanged when within the cap", () => {
    expect(capBytes("hello", 1000)).toBe("hello");
  });

  it("is disabled for a non-positive cap", () => {
    const big = "x".repeat(5000);
    expect(capBytes(big, 0)).toBe(big);
    expect(capBytes(big, -1)).toBe(big);
  });

  it("truncates over-cap text, keeping a prefix and an elision marker", () => {
    const out = capBytes("a".repeat(500), 120);
    expect(out).not.toBe("a".repeat(500));
    expect(out.startsWith("aaaa")).toBe(true);
    expect(out).toContain("truncated");
    // The kept portion (before the marker) stays within the byte budget.
    const kept = out.slice(0, out.indexOf("\n…"));
    expect(Buffer.byteLength(kept, "utf8")).toBeLessThanOrEqual(120);
  });

  it("never splits a multi-byte char into a replacement char", () => {
    const out = capBytes("é".repeat(300), 100); // each é = 2 UTF-8 bytes
    expect(out).not.toContain("�");
    expect(out).toContain("truncated");
  });
});

describe("unknownToolNames", () => {
  it("is empty when the def declares no tools (inherits the default set)", () => {
    expect(unknownToolNames(def(undefined))).toEqual([]);
  });

  it("accepts known tools, including a (scope) suffix and odd casing", () => {
    expect(unknownToolNames(def(["read", "Bash", "edit(src/**)"]))).toEqual([]);
  });

  it("flags typo'd / unsupported tool names that would be silently dropped", () => {
    expect(unknownToolNames(def(["reaad", "grep", "nope"]))).toEqual(["reaad", "nope"]);
  });
});

describe("subagent streaming", () => {
  it("uses the configured provider with resolved auth and returns its output and usage", async () => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const registry = new ModelRegistry(runtime);
    let streamedOptions: SimpleStreamOptions | undefined;
    let prompt: string | undefined;
    registry.registerProvider("subagent-test", {
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      headers: { "x-subagent": "test" },
      models: [
        {
          id: "test-model",
          name: "Test model",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 10000,
          maxTokens: 1000,
        },
      ],
      streamSimple: (model, context, options) => {
        streamedOptions = options;
        const first = context.messages.find((message) => message.role === "user");
        if (first?.role === "user") {
          prompt =
            typeof first.content === "string"
              ? first.content
              : first.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("");
        }
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "child output" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 2,
            output: 3,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 5,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 0,
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      },
    });
    const unscripted = (): never => {
      throw new Error("subagent UI is not scripted");
    };
    const ui: ExtensionUIContext = {
      select: unscripted,
      confirm: unscripted,
      input: unscripted,
      notify: unscripted,
      onTerminalInput: unscripted,
      setStatus: unscripted,
      setWorkingMessage: unscripted,
      setWorkingVisible: unscripted,
      setWorkingIndicator: unscripted,
      setHiddenThinkingLabel: unscripted,
      setWidget: unscripted,
      setFooter: unscripted,
      setHeader: unscripted,
      setTitle: unscripted,
      custom: unscripted,
      pasteToEditor: unscripted,
      setEditorText: unscripted,
      getEditorText: unscripted,
      editor: unscripted,
      addAutocompleteProvider: unscripted,
      setEditorComponent: unscripted,
      getEditorComponent: unscripted,
      get theme() {
        return unscripted();
      },
      getAllThemes: unscripted,
      getTheme: unscripted,
      setTheme: unscripted,
      getToolsExpanded: unscripted,
      setToolsExpanded: unscripted,
    };
    const result = await runSubagent({
      def: def([]),
      prompt: "child task",
      description: "test",
      cwd: process.cwd(),
      registry,
      parentModel: registry.find("subagent-test", "test-model"),
      ui,
      interactive: false,
      signal: undefined,
      background: false,
      outputCapBytes: 1000,
    });
    expect(result).toMatchObject({
      text: "child output",
      isError: false,
      details: { status: "done", tokens: 5, toolCalls: [] },
    });
    expect(prompt).toBe("child task");
    expect(streamedOptions?.apiKey).toBe("test-key");
    expect(streamedOptions?.headers).toMatchObject({ "x-subagent": "test" });
  });
});
