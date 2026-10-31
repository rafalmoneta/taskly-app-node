import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listChangedFiles } from "../../src/agent/git.ts";
import { summarizeRun } from "../../src/agent/result.ts";
import { createRunSession, resolveModel } from "../../src/agent/session.ts";
import { loadConfig } from "../../src/config.ts";

const packageDir = fileURLToPath(new URL("../../", import.meta.url));
const agentDir = path.join(packageDir, "pi");
const config = loadConfig(path.join(packageDir, "config.json"));

let sandbox: string;
let repoRoot: string;

beforeEach(() => {
  vi.stubEnv("PI_OFFLINE", "1");
  sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "session-")));
  const foreignSkill = path.join(
    sandbox,
    "home",
    ".agents",
    "skills",
    "foreign",
  );
  mkdirSync(foreignSkill, { recursive: true });
  writeFileSync(
    path.join(foreignSkill, "SKILL.md"),
    "---\nname: foreign\ndescription: A skill from the user's machine.\n---\n",
  );
  vi.stubEnv("HOME", path.join(sandbox, "home"));
  repoRoot = path.join(sandbox, "repo");
  mkdirSync(path.join(repoRoot, "backend", "tests"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "backend", "src", "users.ts"),
    "export {};\n",
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--quiet");
  git("add", "-A");
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "--quiet",
    "-m",
    "x",
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("resolveModel", () => {
  const modelRef = config.roles.pr.model;

  it("takes the key from a file in place of the environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "from-env");
    const apiKeyFile = path.join(sandbox, "agent-api-key");
    writeFileSync(apiKeyFile, "from-file");

    const { model, modelRuntime } = await resolveModel({
      agentDir,
      modelRef,
      authPath: path.join(sandbox, "auth.json"),
      apiKeyFile,
    });

    expect((await modelRuntime.getAuth(model))?.auth).toEqual({
      apiKey: "from-file",
    });
    expect(existsSync(apiKeyFile)).toBe(false);
  });

  it("refuses an empty key file", async () => {
    const apiKeyFile = path.join(sandbox, "agent-api-key");
    writeFileSync(apiKeyFile, "");

    await expect(
      resolveModel({
        agentDir,
        modelRef,
        authPath: path.join(sandbox, "auth.json"),
        apiKeyFile,
      }),
    ).rejects.toThrow(/is empty/);
  });

  it("keeps reading the environment without a key file", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "from-env");

    const { model, modelRuntime } = await resolveModel({
      agentDir,
      modelRef,
      authPath: path.join(sandbox, "auth.json"),
    });

    expect((await modelRuntime.getAuth(model))?.auth).toEqual({
      apiKey: "from-env",
    });
  });
});

describe("a run through the real extensions", () => {
  it("refuses to start when an extension fails to load", async () => {
    const packageCopy = path.join(sandbox, "package");
    cpSync(agentDir, path.join(packageCopy, "pi"), { recursive: true });
    for (const shared of ["src", "config.json", "node_modules"]) {
      symlinkSync(
        path.join(packageDir, shared),
        path.join(packageCopy, shared),
      );
    }
    writeFileSync(
      path.join(packageCopy, "pi", "extensions", "broken.ts"),
      "export default function (\n",
    );
    const faux = fauxProvider();
    const modelRuntime = await ModelRuntime.create({
      modelsPath: path.join(agentDir, "models.json"),
      authPath: path.join(sandbox, "auth.json"),
    });
    modelRuntime.registerNativeProvider(faux.provider);

    await expect(
      createRunSession({
        repoRoot,
        agentDir: path.join(packageCopy, "pi"),
        model: faux.getModel(),
        modelRuntime,
        thinking: "off",
        sessionDir: path.join(sandbox, "sessions"),
      }),
    ).rejects.toThrow(/Extensions failed to load:[\s\S]*broken\.ts/);
  });

  it("offers only the committed skills", async () => {
    const faux = fauxProvider();
    const modelRuntime = await ModelRuntime.create({
      modelsPath: path.join(agentDir, "models.json"),
      authPath: path.join(sandbox, "auth.json"),
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const session = await createRunSession({
      repoRoot,
      agentDir,
      model: faux.getModel(),
      modelRuntime,
      thinking: "off",
      sessionDir: path.join(sandbox, "sessions"),
    });
    const skills = session.resourceLoader
      .getSkills()
      .skills.map((skill) => skill.name);
    session.dispose();

    expect(skills.sort()).toEqual(
      readdirSync(path.join(agentDir, "skills")).sort(),
    );
  });

  it(
    "enforces the policy, stops at report_result and does not trust the report",
    { timeout: 30_000 },
    async () => {
      const faux = fauxProvider();
      const call = (
        id: string,
        name: string,
        args: Parameters<typeof fauxToolCall>[1],
      ) =>
        fauxAssistantMessage([fauxToolCall(name, args, { id })], {
          stopReason: "toolUse",
        });
      const report = {
        decision: "tests_added",
        reason: "Covered the users module.",
        changes: [
          {
            source: "backend/src/users.ts",
            test: "backend/tests/new.test.ts",
            action: "created",
            why: "New module.",
          },
        ],
        not_covered: [],
      };
      const unexpectedTurn = fauxAssistantMessage("Still going.");
      faux.setResponses([
        call("evil", "write", {
          path: "backend/src/evil.ts",
          content: "export const evil = true;\n",
        }),
        call("peek", "read", { path: "/etc/hosts" }),
        call("good", "write", {
          path: "backend/tests/new.test.ts",
          content: "// a test\n",
        }),
        call("report", "report_result", report),
        unexpectedTurn,
      ]);

      const modelRuntime = await ModelRuntime.create({
        modelsPath: path.join(agentDir, "models.json"),
        authPath: path.join(sandbox, "auth.json"),
      });
      modelRuntime.registerNativeProvider(faux.provider);
      const session = await createRunSession({
        repoRoot,
        agentDir,
        model: faux.getModel(),
        modelRuntime,
        thinking: "off",
        sessionDir: path.join(sandbox, "sessions"),
      });

      await session.prompt("Write unit tests for the backend change.");
      const messages = session.messages;
      session.dispose();

      const resultOf = (toolCallId: string) => {
        const result = messages.find(
          (m) => m.role === "toolResult" && m.toolCallId === toolCallId,
        );
        if (result?.role !== "toolResult") {
          throw new Error(`No result for tool call ${toolCallId}`);
        }
        const text = result.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n");
        return { isError: result.isError, text };
      };

      const evil = resultOf("evil");
      expect(evil.isError).toBe(true);
      expect(evil.text).toContain("backend/tests");
      expect(existsSync(path.join(repoRoot, "backend", "src", "evil.ts"))).toBe(
        false,
      );

      const peek = resultOf("peek");
      expect(peek.isError).toBe(true);
      expect(peek.text).not.toContain("localhost");

      expect(resultOf("good").isError).toBe(false);
      expect(
        readFileSync(
          path.join(repoRoot, "backend", "tests", "new.test.ts"),
          "utf8",
        ),
      ).toBe("// a test\n");

      expect(resultOf("report").isError).toBe(false);
      expect(faux.state.callCount).toBe(4);
      expect(faux.getPendingResponseCount()).toBe(1);

      const result = summarizeRun({
        model: "faux/faux",
        messages,
        stats: session.getSessionStats(),
        startedAt: 0,
        finishedAt: 1000,
        apps: config.apps,
        policy: config.policy,
        changedFiles: listChangedFiles(repoRoot),
        verification: [],
      });
      expect(result.report).toEqual(report);
      expect(result.changedFiles).toEqual(["backend/tests/new.test.ts"]);
      expect(result.outcome).toBe("unverified");
    },
  );
});
