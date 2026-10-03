import { ConfigProvider, Effect, Exit, Redacted } from "effect";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as ExecutorClient from "./client.ts";

const fromEnv = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    ExecutorClient.optionsFromEnv.pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  );

describe("ExecutorClient.optionsFromEnv", () => {
  it("requires the base URL", async () => {
    expect(Exit.isFailure(await fromEnv({}))).toBe(true);
  });

  it("sends no Access token when none is configured", async () => {
    const exit = await fromEnv({ EXECUTOR_BASE_URL: "http://localhost:4788" });
    expect(exit).toEqual(Exit.succeed({ baseUrl: "http://localhost:4788" }));
  });

  it("reads the Access token from files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "executor-config-"));
    await writeFile(join(dir, "id"), "client-id\n");
    await writeFile(join(dir, "secret"), "client-secret\n");

    const exit = await fromEnv({
      EXECUTOR_BASE_URL: "https://executor.example",
      EXECUTOR_CLIENT_ID_FILE: join(dir, "id"),
      EXECUTOR_CLIENT_SECRET_FILE: join(dir, "secret"),
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.access?.clientId).toBe("client-id");
    expect(Redacted.value(exit.value.access!.clientSecret)).toBe("client-secret");
  });

  it("rejects an id without a secret", async () => {
    const exit = await fromEnv({
      EXECUTOR_BASE_URL: "https://executor.example",
      EXECUTOR_CLIENT_ID: "client-id",
    });
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain("or neither");
  });
});
