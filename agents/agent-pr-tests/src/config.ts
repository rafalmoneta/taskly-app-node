import { readFileSync } from "node:fs";
import { type Static, Type } from "typebox";
import { Check, Errors } from "typebox/value";
import { StringEnum } from "@earendil-works/pi-ai";

const NonEmptyString = Type.String({ minLength: 1, pattern: "\\S" });

const Thinking = StringEnum(
  ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const,
  { description: "Thinking level" },
);

const Role = Type.Object(
  {
    model: Type.String({
      pattern: "^[^\\s/]+/[^\\s]+$",
      description: "provider/model-id",
    }),
    thinking: Thinking,
    softTurns: Type.Integer({ minimum: 1 }),
    hardTurns: Type.Integer({ minimum: 1 }),
    softUsd: Type.Number({ minimum: 0 }),
    hardUsd: Type.Number({ minimum: 0 }),
    wallClockMin: Type.Number({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const Command = Type.Array(NonEmptyString, { minItems: 1 });

const App = Type.Object(
  {
    cwd: Type.String({
      minLength: 1,
      pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*[\\\\:\\s]).+$",
      description: "Repository-relative directory without parent traversal",
    }),
    typecheck: Command,
    vitest: Command,
    format: Type.Array(NonEmptyString, {
      description:
        "Formatter command, run on the changed files; empty skips formatting for this app",
    }),
  },
  { additionalProperties: false },
);

export const ConfigSchema = Type.Object(
  {
    roles: Type.Object({ pr: Role }, { additionalProperties: false }),
    policy: Type.Object(
      {
        writable: Type.Array(NonEmptyString, { minItems: 1 }),
        forbidden: Type.Array(NonEmptyString),
        maxViolations: Type.Integer({ minimum: 1 }),
        maxFilesPerRun: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    apps: Type.Record(NonEmptyString, App, { minProperties: 1 }),
  },
  { additionalProperties: false },
);

export type AgentConfig = Static<typeof ConfigSchema>;
export type ThinkingLevel = Static<typeof Thinking>;

export function loadConfig(path: string): AgentConfig {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`Unable to read configuration ${path}`, { cause });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (cause) {
    throw new Error(`Invalid ${path}: expected valid JSON`, { cause });
  }

  if (!Check(ConfigSchema, raw)) {
    const errors = [...Errors(ConfigSchema, raw)]
      .slice(0, 5)
      .map((error) => `${error.instancePath || "/"}: ${error.message}`);
    throw new Error(`Invalid ${path}:\n${errors.join("\n")}`);
  }

  const { pr } = raw.roles;
  if (pr.softTurns > pr.hardTurns || pr.softUsd > pr.hardUsd) {
    throw new Error(
      `Invalid ${path}: role pr soft limits must not exceed hard limits`,
    );
  }

  return raw as AgentConfig;
}
