import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const publishCli = fileURLToPath(
  new URL("../../src/publish.ts", import.meta.url),
);

let sandbox: string;
let githubOutput: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "publish-"));
  githubOutput = path.join(sandbox, "github-output");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function publish(args: string[], input = "") {
  const result = spawnSync(process.execPath, [publishCli, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: githubOutput },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("publish check", () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });

  const write = (file: string, content = "// test\n") => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
  };

  const checkStaged = () => {
    git("add", "-A");
    return publish(
      ["check"],
      git("diff", "--cached", "--raw", "--no-renames", "-z"),
    );
  };

  beforeEach(() => {
    repo = path.join(sandbox, "repo");
    mkdirSync(repo);
    git("init", "--quiet");
    write("backend/tests/edited.test.ts");
    write("backend/tests/renamed.test.ts");
    write("backend/tests/deleted.test.ts");
    symlinkSync(
      "edited.test.ts",
      path.join(repo, "backend/tests/linked.test.ts"),
    );
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

  it("accepts new and edited test files", () => {
    write("backend/tests/users.test.ts");
    write("frontend/src/Card.test.tsx");
    write("backend/tests/edited.test.ts", "// edited\n");
    expect(checkStaged().status).toBe(0);
  });

  it("accepts a test file with a non-ASCII name", () => {
    write("backend/tests/café.test.ts");
    expect(checkStaged().status).toBe(0);
  });

  it("accepts an empty patch", () => {
    expect(checkStaged().status).toBe(0);
  });

  it("rejects every path outside the write policy and names it", () => {
    const forbidden = [
      ".github/workflows/ci.yml",
      "backend/src/users.ts",
      "backend/package.json",
      "agents/agent-pr-tests/config.json",
      "backend/tests/node_modules/x/y.test.ts",
    ];
    for (const file of forbidden) write(file);
    write("backend/tests/ok.test.ts");

    const run = checkStaged();

    expect(run.status).toBe(1);
    for (const file of forbidden) {
      expect(run.stdout).toContain(
        `::error::The test agent may not change "${file}"`,
      );
    }
    expect(run.stdout).not.toContain("ok.test.ts");
  });

  it("rejects a rename, which git reports as a deletion and an addition", () => {
    git("mv", "backend/tests/renamed.test.ts", "backend/tests/moved.test.ts");

    const run = checkStaged();

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      '::error::The test agent may only add or edit regular files, not "backend/tests/renamed.test.ts" (status D, mode 000000)',
    );
  });

  it("rejects the deletion of a test file", () => {
    rmSync(path.join(repo, "backend/tests/deleted.test.ts"));
    const run = checkStaged();
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("(status D, mode 000000)");
  });

  it("rejects a symlink in a writable path", () => {
    symlinkSync("../../..", path.join(repo, "backend/tests/link.test.ts"));
    const run = checkStaged();
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      '"backend/tests/link.test.ts" (status A, mode 120000)',
    );
  });

  it("rejects a symlink that a regular file replaces, a type change", () => {
    rmSync(path.join(repo, "backend/tests/linked.test.ts"));
    write("backend/tests/linked.test.ts");
    const run = checkStaged();
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      '"backend/tests/linked.test.ts" (status T, mode 100644)',
    );
  });

  it("rejects an executable file in a writable path", () => {
    write("backend/tests/run.test.ts");
    chmodSync(path.join(repo, "backend/tests/run.test.ts"), 0o755);
    const run = checkStaged();
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      '"backend/tests/run.test.ts" (status A, mode 100755)',
    );
  });

  it("rejects a patch that touches too many files", () => {
    for (let index = 0; index < 9; index++) {
      write(`backend/tests/case${index}.test.ts`);
    }
    const run = checkStaged();
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("9 files");
  });

  it("keeps a newline in a file name from starting a workflow command", () => {
    write("backend/src/x\n::stop-commands::y.ts");
    const run = checkStaged();
    expect(run.status).toBe(1);
    const lines = run.stdout.split("\n").filter((line) => line !== "");
    expect(lines.every((line) => line.startsWith("::error::"))).toBe(true);
  });

  it.each([
    ["text that is not git output", "backend/tests/a.test.ts\n"],
    ["an entry without a path", ":000000 100644 0000000 abc1234 A\0"],
    [
      "output that does not end with a NUL",
      ":000000 100644 0000000 abc1234 A\0backend/tests/a.test.ts",
    ],
    [
      "a rename entry",
      ":100644 100644 abc1234 abc1234 R100\0backend/tests/a.test.ts\0backend/tests/b.test.ts\0",
    ],
  ])("rejects %s", (_case, input) => {
    const run = publish(["check"], input);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("::error::Unrecognized output of git diff");
  });
});

describe("publish report", () => {
  const writeResult = (content: string) => {
    const file = path.join(sandbox, "result.json");
    writeFileSync(file, content);
    return file;
  };
  const verifiedResult = {
    model: "anthropic/claude-sonnet-4-5",
    turns: 3,
    costUsd: 0.1,
    seconds: 10,
    stopReason: "toolUse",
    report: {
      decision: "tests_added",
      reason: "Added tests.",
      changes: [],
      not_covered: [],
    },
    outcome: "verified",
    verification: [],
    changedFiles: [],
  };

  it("prints the comment and exports the check run conclusion and title", () => {
    const run = publish([
      "report",
      writeResult(JSON.stringify(verifiedResult)),
      "--pushed",
      "--ci",
      "success",
      "--run-url",
      "https://example.test/run/1",
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout.split("\n")[0]).toBe("<!-- taskly-unit-test-agent -->");
    expect(run.stdout).toContain("committed them to this branch");
    expect(run.stdout).toContain("https://example.test/run/1");
    expect(readFileSync(githubOutput, "utf8")).toBe(
      "conclusion=success\ntitle=Tests written and verified\n",
    );
  });

  it("fails the check run of a verified run whose CI failed", () => {
    const run = publish([
      "report",
      writeResult(JSON.stringify(verifiedResult)),
      "--ci",
      "failure",
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("CI failed on this PR's head");
    expect(readFileSync(githubOutput, "utf8")).toBe(
      "conclusion=failure\ntitle=Tests verified but CI failed\n",
    );
  });

  it.each([
    ["a missing file", () => path.join(sandbox, "missing.json")],
    ["a file that is not JSON", () => writeResult("{oops")],
    [
      "JSON that is not a run result",
      () => writeResult('{"outcome":"constructor"}'),
    ],
    ["JSON null", () => writeResult("null")],
  ])("renders a failure for %s", (_case, file) => {
    const run = publish(["report", file()]);

    expect(run.status).toBe(0);
    expect(readFileSync(githubOutput, "utf8")).toBe(
      "conclusion=failure\ntitle=The agent produced no result\n",
    );
  });

  it.each([
    [[]],
    [["unknown"]],
    [["check", "extra"]],
    [["report"]],
    [["report", "a.json", "b.json"]],
    [["report", "a.json", "--unknown"]],
    [["report", "a.json", "--ci"]],
    [["report", "a.json", "--ci", "passed"]],
  ])("prints the usage line for %j", (args) => {
    const run = publish(args);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage: node src/publish.ts");
    expect(run.stdout).toBe("");
  });
});
