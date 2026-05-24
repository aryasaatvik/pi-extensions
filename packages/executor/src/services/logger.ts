import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Effect, Layer, Logger, References } from "effect";

const logPath = join(getAgentDir(), "executor-pi.log");

const namespaceMatches = (pattern: string, namespace: string): boolean => {
  if (pattern === "*") return true;
  if (pattern.endsWith(":*")) {
    const base = pattern.slice(0, -2);
    return namespace === base || namespace.startsWith(`${base}:`);
  }
  if (pattern.endsWith("*")) return namespace.startsWith(pattern.slice(0, -1));
  return namespace === pattern;
};

export const isDebugNamespaceEnabled = (
  debug: string | undefined,
  namespace = "executor-pi",
): boolean => {
  if (!debug) return false;

  const patterns = debug
    .split(/[,\s]+/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  const disabled = patterns.some(
    (pattern) => pattern.startsWith("-") && namespaceMatches(pattern.slice(1), namespace),
  );
  if (disabled) return false;

  return patterns.some(
    (pattern) => !pattern.startsWith("-") && namespaceMatches(pattern, namespace),
  );
};

const isDebugEnabled = (namespace = "executor-pi"): boolean =>
  isDebugNamespaceEnabled(process.env.DEBUG, namespace);

const writeLog = (level: string, event: string, fields: Record<string, unknown>): void => {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(
    logPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      namespace: "executor-pi",
      event,
      fields,
    })}\n`,
  );
};

const logMessageText = (message: unknown): string =>
  Array.isArray(message) ? message.map((part) => String(part)).join(" ") : String(message);

export const ExecutorPiLogger = Logger.make<unknown, void>((options) => {
  const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
  const message = logMessageText(options.message);

  writeLog(options.logLevel.toLowerCase(), message, annotations);
});

export const ExecutorPiLoggerLayer = Layer.mergeAll(
  Logger.layer([ExecutorPiLogger]),
  Layer.succeed(References.MinimumLogLevel, isDebugEnabled() ? "Debug" : "Info"),
);
