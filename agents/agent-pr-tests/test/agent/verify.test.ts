import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../../src/config.ts";
import { verifyApp, verifyChangedApps } from "../../src/agent/verify.ts";

const fakeTools = fileURLToPath(
  new URL("./fixtures/fake-tools.ts", import.meta.url),
);

const app = (
  cwd: string,
  overrides: Partial<AgentConfig["apps"][string]> = {},
) => ({
  cwd,
  format: [process.execPath, fakeTools, "prettier", "--write"],
  typecheck: [process.execPath, fakeTools, "tsc"],
  vitest: [process.execPath, fakeTools, "vitest"],
  ...overrides,
});

let repoRoot: string;
let appDir: string;

const write = (file: string, content: string) => {
  const target = path.join(appDir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const read = (file: string) => readFileSync(path.join(appDir, file), "utf8");

const toolCalls = () => read("tool-calls.log").trim().split("\n");

const verify = (overrides: Partial<AgentConfig["apps"][string]> = {}) =>
  verifyApp({
    repoRoot,
    appName: "backend",
    app: app("backend", overrides),
    files: ["tests/users.test.ts"],
    baselineDir: path.join(repoRoot, "baseline"),
  });

beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "verify-")));
  appDir = path.join(repoRoot, "backend");
  write("src/users.ts", "export {};\n");
  write("tests/users.test.ts", "pass adds\npass removes\n");
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("verifyApp", () => {
  it("passes when the formatter, the typecheck and the full suite are clean", async () => {
    mkdirSync(path.join(repoRoot, "baseline"));
    writeFileSync(
      path.join(repoRoot, "baseline", "backend.json"),
      JSON.stringify({
        total: Object.fromEntries(
          ["lines", "branches", "functions", "statements"].map((key) => [
            key,
            { pct: 70 },
          ]),
        ),
      }),
    );

    expect(await verify()).toMatchObject({
      app: "backend",
      passed: true,
      formatExitCode: 0,
      typecheckExitCode: 0,
      tests: {
        passed: 2,
        failed: 0,
        exitCode: 0,
        coverage: { lines: 80 },
        baseline: { lines: 70 },
      },
    });
  });

  it("formats the given files before anything else runs", async () => {
    write("tests/users.test.ts", "pass adds   \n");

    await verify();

    expect(read("tests/users.test.ts")).toBe("pass adds\n");
    expect(toolCalls().map((call) => call.split(" ")[0])).toEqual([
      "prettier",
      "tsc",
      "vitest",
    ]);
    expect(toolCalls()[0]).toBe("prettier --write tests/users.test.ts");
  });

  it("does not format an app that has no formatter", async () => {
    const result = await verify({ format: [] });

    expect(result.passed).toBe(true);
    expect(result.formatExitCode).toBeUndefined();
    expect(toolCalls().map((call) => call.split(" ")[0])).toEqual([
      "tsc",
      "vitest",
    ]);
  });

  it("judges the files as they are now, not an earlier green run", async () => {
    expect((await verify()).passed).toBe(true);

    write("tests/users.test.ts", "pass adds\nfail removes\n");
    const result = await verify();

    expect(result.passed).toBe(false);
    expect(result.tests.failures).toEqual([
      { name: "users.test.ts > removes", message: "AssertionError: nope" },
    ]);
  });

  it("fails when the formatter rejects a file", async () => {
    write("tests/users.test.ts", "pass adds\nsyntax-error\n");
    const result = await verify();
    expect(result).toMatchObject({ passed: false, formatExitCode: 2 });
  });

  it("fails when the typecheck is red although the tests pass", async () => {
    write("src/users.ts", "type-error\n");
    const result = await verify();
    expect(result).toMatchObject({
      passed: false,
      typecheckExitCode: 2,
      tests: { failed: 0, exitCode: 0 },
    });
  });

  it("fails when vitest exits non-zero although no test failed", async () => {
    write("tests/users.test.ts", "pass adds\nthreshold\n");
    const result = await verify();
    expect(result).toMatchObject({
      passed: false,
      tests: { failed: 0, exitCode: 1 },
    });
  });

  it("fails when vitest leaves no report", async () => {
    write("tests/users.test.ts", "crash\n");
    const result = await verify();
    expect(result.passed).toBe(false);
    expect(result.tests.failures[0].message).toContain(
      "No readable test report",
    );
  });

  it("never reuses the report of an earlier run", async () => {
    expect((await verify()).passed).toBe(true);

    write("tests/users.test.ts", "crash\n");
    const result = await verify();

    expect(result.passed).toBe(false);
    expect(result.tests.passed).toBe(0);
  });

  it("does not trust a green report from a vitest the system killed", async () => {
    write("tests/users.test.ts", "pass adds\nkill\n");
    const result = await verify();
    expect(result).toMatchObject({
      passed: false,
      tests: { passed: 1, failed: 0, exitCode: 1 },
    });
  });
});

describe("verifyChangedApps", () => {
  it("verifies only the apps that own a changed file, with app-relative paths", async () => {
    const other = path.join(repoRoot, "frontend");
    mkdirSync(path.join(other, "tests"), { recursive: true });

    const verification = await verifyChangedApps({
      repoRoot,
      apps: { backend: app("backend"), frontend: app("frontend") },
      changedFiles: ["backend/tests/users.test.ts", "backend-tools/x.ts"],
      baselineDir: path.join(repoRoot, "baseline"),
    });

    expect(verification.map((v) => v.app)).toEqual(["backend"]);
    expect(toolCalls()[0]).toBe("prettier --write tests/users.test.ts");
  });
});
