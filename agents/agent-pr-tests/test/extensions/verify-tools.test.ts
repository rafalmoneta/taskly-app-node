import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import verifyTools from "../../pi/extensions/verify-tools.ts";
import { type Exec, loadExtension } from "./fake-pi.ts";

let repoRoot: string;

const finished = { stdout: "", stderr: "", code: 0, killed: false };

const write = (file: string, content: unknown) => {
  const target = path.join(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(content));
};

const vitestReport = (passed: number, failed: number) => ({
  numPassedTests: passed,
  testResults: [
    {
      name: "/repo/backend/tests/a.test.ts",
      status: failed > 0 ? "failed" : "passed",
      assertionResults: [
        ...Array.from({ length: passed }, (_, i) => ({
          fullName: `passes ${i}`,
          status: "passed",
          failureMessages: [],
        })),
        ...Array.from({ length: failed }, (_, i) => ({
          fullName: `fails ${i}`,
          status: "failed",
          failureMessages: ["AssertionError: nope"],
        })),
      ],
    },
  ],
});

const coverageSummary = (lines: number) => {
  const entry = { pct: lines };
  return {
    total: {
      lines: entry,
      branches: entry,
      functions: entry,
      statements: entry,
    },
  };
};

function scriptedVitest(...reports: unknown[]) {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const exec: Exec = async (command, args, { cwd }) => {
    calls.push({ command, args, cwd });
    const report = reports[calls.length - 1];
    if (report !== undefined) {
      mkdirSync(path.join(cwd, ".artifacts"), { recursive: true });
      writeFileSync(
        path.join(cwd, ".artifacts", "vitest.json"),
        JSON.stringify(report),
      );
    }
    return finished;
  };
  return { exec, calls };
}

beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "verify-")));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("run_tests", () => {
  it("runs the full suite with coverage and compares it to the baseline", async () => {
    const vitest = scriptedVitest(vitestReport(3, 0));
    const extension = await loadExtension(verifyTools, async (...call) => {
      write("backend/coverage/coverage-summary.json", coverageSummary(92));
      return vitest.exec(...call);
    });
    write(".artifacts/coverage-baseline/backend.json", coverageSummary(90));

    const result = await extension.callTool(
      "run_tests",
      { app: "backend" },
      repoRoot,
    );

    expect(result.details).toMatchObject({
      app: "backend",
      scope: "all",
      passed: 3,
      failed: 0,
      flaky: false,
      exitCode: 0,
      coverage: { lines: 92 },
      baseline: { lines: 90 },
    });
    expect(vitest.calls[0].args).toContain("--coverage");
    expect(vitest.calls[0].cwd).toBe(path.join(repoRoot, "backend"));
  });

  it("runs only the selected files, without coverage", async () => {
    const vitest = scriptedVitest(vitestReport(1, 0));
    const extension = await loadExtension(verifyTools, async (...call) => {
      write("backend/coverage/coverage-summary.json", coverageSummary(50));
      return vitest.exec(...call);
    });

    const result = await extension.callTool(
      "run_tests",
      { app: "backend", files: ["backend/tests/a.test.ts"] },
      repoRoot,
    );

    expect(result.details).toMatchObject({ scope: "files" });
    expect(result.details).not.toHaveProperty("coverage");
    expect(vitest.calls[0].args).not.toContain("--coverage");
    expect(vitest.calls[0].args.at(-1)).toBe("tests/a.test.ts");
  });

  it.each([
    ["a file of another app", "frontend/src/a.test.ts"],
    ["a file outside the repository", "/etc/hosts"],
    ["a path that climbs out of the app", "backend/../frontend/src/a.test.ts"],
    [
      "a file name that vitest would read as an option",
      "backend/--config=a.ts",
    ],
  ])("refuses %s", async (_case, file) => {
    const vitest = scriptedVitest();
    const extension = await loadExtension(verifyTools, vitest.exec);

    await expect(
      extension.callTool(
        "run_tests",
        { app: "backend", files: [file] },
        repoRoot,
      ),
    ).rejects.toThrow(/Refused path/);
    expect(vitest.calls).toEqual([]);
  });

  it("flags a run whose repeats disagree as flaky", async () => {
    const vitest = scriptedVitest(
      vitestReport(2, 0),
      vitestReport(1, 1),
      vitestReport(2, 0),
    );
    const extension = await loadExtension(verifyTools, vitest.exec);

    const result = await extension.callTool(
      "run_tests",
      { app: "backend", repeat: 3 },
      repoRoot,
    );

    expect(vitest.calls).toHaveLength(3);
    expect(result.details).toMatchObject({ runs: 3, flaky: true });
  });

  it("does not call a run flaky when every repeat fails the same way", async () => {
    const vitest = scriptedVitest(vitestReport(1, 1), vitestReport(1, 1));
    const extension = await loadExtension(verifyTools, vitest.exec);

    const result = await extension.callTool(
      "run_tests",
      { app: "backend", repeat: 2 },
      repoRoot,
    );

    expect(result.details).toMatchObject({ flaky: false, failed: 1 });
  });

  it("reports a non-zero exit code when vitest was killed", async () => {
    const vitest = scriptedVitest(vitestReport(3, 0));
    const extension = await loadExtension(verifyTools, async (...call) => ({
      ...(await vitest.exec(...call)),
      killed: true,
    }));

    const result = await extension.callTool(
      "run_tests",
      { app: "backend" },
      repoRoot,
    );

    expect(result.details).toMatchObject({ passed: 3, exitCode: 1 });
  });

  it("fails the run when vitest leaves no report, never reusing an old one", async () => {
    const vitest = scriptedVitest(vitestReport(3, 0));
    const extension = await loadExtension(verifyTools, vitest.exec);

    await extension.callTool("run_tests", { app: "backend" }, repoRoot);
    const second = await extension.callTool(
      "run_tests",
      { app: "backend" },
      repoRoot,
    );

    expect(second.details).toMatchObject({ passed: 0, failed: 1 });
  });
});

describe("typecheck", () => {
  it("reports the exit code and the compiler output of a failure", async () => {
    const extension = await loadExtension(verifyTools, async () => ({
      ...finished,
      code: 2,
      stdout: "src/a.ts(1,1): error TS2322",
    }));

    const result = await extension.callTool(
      "typecheck",
      { app: "frontend" },
      repoRoot,
    );

    expect(result.details).toEqual({ app: "frontend", exitCode: 2 });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("error TS2322"),
    });
  });
});
