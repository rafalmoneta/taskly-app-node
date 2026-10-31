import { execFileSync } from "node:child_process";
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
import { listChangedFiles } from "../../src/agent/git.ts";

let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });

const write = (file: string, content: string) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
};

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), "git-")));
  git("init", "--quiet");
  write(".gitignore", "coverage/\n");
  write("backend/src/app.ts", "export {};\n");
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
  rmSync(repo, { recursive: true, force: true });
});

describe("listChangedFiles", () => {
  it("is empty for a clean checkout", () => {
    expect(listChangedFiles(repo)).toEqual([]);
  });

  it("lists new files in new directories and edited tracked files", () => {
    write("backend/tests/deep/users.test.ts", "// new");
    write("backend/src/app.ts", "export const changed = true;\n");
    expect(listChangedFiles(repo).sort()).toEqual([
      "backend/src/app.ts",
      "backend/tests/deep/users.test.ts",
    ]);
  });

  it("keeps unusual file names unquoted and skips ignored files", () => {
    write("backend/tests/café test.test.ts", "// new");
    write("backend/coverage/lcov.info", "ignored");
    expect(listChangedFiles(repo)).toEqual(["backend/tests/café test.test.ts"]);
  });

  it("throws outside a git repository", () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), "no-git-"));
    try {
      expect(() => listChangedFiles(notARepo)).toThrow(/git status failed/);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
