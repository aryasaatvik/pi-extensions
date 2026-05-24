import { describe, expect, it } from "vitest";

import { prepareExecuteSource } from "./code.ts";

describe("prepareExecuteSource", () => {
  it("returns a trailing expression so tool calls are awaited by the execution wrapper", () => {
    expect(prepareExecuteSource("tools.cloudflare_api.accounts.accountsListAccounts({})")).toBe(
      "return await (tools.cloudflare_api.accounts.accountsListAccounts({}));",
    );
  });

  it("keeps existing top-level returns unchanged", () => {
    const code = "const value = 1 + 2;\nreturn { value };";

    expect(prepareExecuteSource(code)).toBe(code);
  });

  it("returns the final expression after setup statements", () => {
    expect(prepareExecuteSource("console.log('x');\n1 + 2")).toBe(
      "console.log('x');\nreturn await (1 + 2);",
    );
  });
});
