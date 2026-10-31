import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../config.ts";
import { takeApiKey } from "./api-key.ts";

// A plain list is an allowlist: it replaces Pi's defaults, and an extension
// tool missing from it is never shown to the model.
const TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
  "run_tests",
  "typecheck",
  "report_result",
];

export interface ModelSpec {
  agentDir: string;
  /** `provider/model-id`, optionally with a `:thinking` suffix. */
  modelRef: string;
  authPath?: string;
  /** A file holding the model key. It is read once and deleted. */
  apiKeyFile?: string;
}

export interface ResolvedModel {
  model: Model<Api>;
  /** Set when `modelRef` carried a `:thinking` suffix. */
  thinkingLevel?: ThinkingLevel;
  modelRuntime: ModelRuntime;
}

export async function resolveModel(spec: ModelSpec): Promise<ResolvedModel> {
  const modelRuntime = await ModelRuntime.create({
    modelsPath: path.join(spec.agentDir, "models.json"),
    authPath: spec.authPath ?? path.join(spec.agentDir, "auth.json"),
  });
  const resolved = resolveCliModel({ cliModel: spec.modelRef, modelRuntime });
  if (!resolved.model) {
    throw new Error(resolved.error ?? `Unknown model "${spec.modelRef}"`);
  }
  if (resolved.warning) console.error(`[agent] ${resolved.warning}`);
  if (spec.apiKeyFile !== undefined) {
    await modelRuntime.setRuntimeApiKey(
      resolved.model.provider,
      takeApiKey(spec.apiKeyFile),
    );
  }
  return {
    model: resolved.model,
    thinkingLevel: resolved.thinkingLevel,
    modelRuntime,
  };
}

export interface SessionSpec {
  repoRoot: string;
  agentDir: string;
  model: Model<Api>;
  modelRuntime: ModelRuntime;
  thinking: ThinkingLevel;
  sessionDir: string;
}

export async function createRunSession(
  spec: SessionSpec,
): Promise<AgentSession> {
  // SettingsManager.create trusts the project by default, which loads the
  // PR's .pi/settings.json, .pi/SYSTEM.md and .pi/extensions.
  const untrustedSettings = SettingsManager.create(
    spec.repoRoot,
    spec.agentDir,
    {
      projectTrusted: false,
    },
  );
  const resourceLoader = new DefaultResourceLoader({
    cwd: spec.repoRoot,
    agentDir: spec.agentDir,
    settingsManager: untrustedSettings,
    // AGENTS.md and CLAUDE.md load regardless of trust, and the PR author controls them.
    noContextFiles: true,
    noSkills: true,
    additionalSkillPaths: [path.join(spec.agentDir, "skills")],
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const extensionErrors = resourceLoader.getExtensions().errors;
  if (extensionErrors.length > 0) {
    throw new Error(
      `Extensions failed to load:\n${extensionErrors.map((e) => JSON.stringify(e)).join("\n")}`,
    );
  }
  for (const diagnostic of resourceLoader.getSkills().diagnostics) {
    console.error("[agent] skill:", JSON.stringify(diagnostic));
  }

  const { session } = await createAgentSession({
    cwd: spec.repoRoot,
    agentDir: spec.agentDir,
    model: spec.model,
    thinkingLevel: spec.thinking,
    modelRuntime: spec.modelRuntime,
    settingsManager: untrustedSettings,
    resourceLoader,
    tools: TOOLS,
    sessionManager: SessionManager.create(spec.repoRoot, spec.sessionDir),
  });
  return session;
}
