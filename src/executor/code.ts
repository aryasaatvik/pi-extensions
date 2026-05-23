import { parseSync } from "oxc-parser";

const FENCED_CODE_BLOCK = /```(?:[^\n`]*)?\s*\n([\s\S]*?)```/i;

const extractCandidateSource = (code: string): string => {
  const trimmed = code.trim();
  const fenced = trimmed.match(FENCED_CODE_BLOCK)?.[1];
  return (fenced ?? trimmed).trim();
};

type ParsedProgram = ReturnType<typeof parseSync>["program"];

const hasTopLevelReturn = (program: ParsedProgram): boolean =>
  program.body.some((statement) => statement.type === "ReturnStatement");

export const prepareExecuteSource = (code: string): string => {
  const source = extractCandidateSource(code);
  if (!source) return "";

  try {
    const result = parseSync("executor.ts", source, {
      lang: "ts",
      sourceType: "module",
    });

    if (result.errors.some((error) => error.severity === "Error")) return source;

    const program = result.program;
    const lastStatement = program.body.at(-1);

    if (
      !lastStatement ||
      hasTopLevelReturn(program) ||
      lastStatement.type !== "ExpressionStatement"
    ) {
      return source;
    }

    const expressionStart = lastStatement.expression.start ?? lastStatement.start ?? 0;
    const expressionEnd = lastStatement.expression.end ?? lastStatement.end ?? source.length;
    const expressionSource = source.slice(expressionStart, expressionEnd);

    return [
      source.slice(0, lastStatement.start ?? expressionStart),
      `return await (${expressionSource});`,
      source.slice(lastStatement.end ?? expressionEnd),
    ].join("");
  } catch {
    return source;
  }
};
