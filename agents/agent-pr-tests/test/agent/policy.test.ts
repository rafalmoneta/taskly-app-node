import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWritable, toRepoRelative } from "../../src/agent/policy.ts";
import { loadConfig } from "../../src/config.ts";

let sandbox: string;
let root: string;
let outside: string;

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "policy-")));
  root = path.join(sandbox, "repo");
  outside = path.join(sandbox, "outside");
  mkdirSync(path.join(root, "backend", "tests"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "backend", "tests", "a.test.ts"), "");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("toRepoRelative", () => {
  it("resolves existing and not yet existing files", () => {
    expect(toRepoRelative(root, "backend/tests/a.test.ts")).toBe(
      "backend/tests/a.test.ts",
    );
    expect(toRepoRelative(root, "backend/tests/new/b.test.ts")).toBe(
      "backend/tests/new/b.test.ts",
    );
  });

  it("accepts absolute paths inside the repo and rejects those outside", () => {
    expect(
      toRepoRelative(root, path.join(root, "backend", "tests", "a.test.ts")),
    ).toBe("backend/tests/a.test.ts");
    expect(toRepoRelative(root, "/etc/hosts")).toBeNull();
  });

  it("strips the @ prefix that Pi allows on tool paths", () => {
    expect(toRepoRelative(root, "@backend/tests/a.test.ts")).toBe(
      "backend/tests/a.test.ts",
    );
  });

  it("rejects parent traversal", () => {
    expect(toRepoRelative(root, "../outside/x.ts")).toBeNull();
    expect(toRepoRelative(root, "backend/../../outside/x.ts")).toBeNull();
  });

  it("keeps file names that merely start with two dots", () => {
    expect(toRepoRelative(root, "..hidden.test.ts")).toBe("..hidden.test.ts");
  });

  it("treats a path below a regular file like any other new path", () => {
    expect(toRepoRelative(root, "backend/tests/a.test.ts/x")).toBe(
      "backend/tests/a.test.ts/x",
    );
  });

  it.each(["~", "~/.ssh/id_rsa", "@~/.npmrc", "file:///etc/passwd"])(
    "rejects %s, which Pi would expand to a path outside the repo",
    (input) => {
      expect(toRepoRelative(root, input)).toBeNull();
    },
  );

  it("keeps a file name that only starts with a tilde", () => {
    expect(toRepoRelative(root, "~backup/a.test.ts")).toBe("~backup/a.test.ts");
  });

  it.each([0x00a0, 0x2000, 0x200a, 0x202f, 0x205f, 0x3000])(
    "rejects a path with the space U+%s, which Pi turns into a plain space",
    (codePoint) => {
      const space = String.fromCodePoint(codePoint);
      expect(
        toRepoRelative(root, `backend/tests/a${space}b.test.ts`),
      ).toBeNull();
    },
  );

  it("keeps a path with a plain space", () => {
    expect(toRepoRelative(root, "backend/tests/a b.test.ts")).toBe(
      "backend/tests/a b.test.ts",
    );
  });

  it("maps the repo root to an empty path, which no write glob matches", () => {
    expect(toRepoRelative(root, ".")).toBe("");
    expect(toRepoRelative(root, root)).toBe("");
  });

  it("rejects the parent directory and absolute paths outside the repo", () => {
    expect(toRepoRelative(root, "..")).toBeNull();
    expect(toRepoRelative(root, "/proc/self/environ")).toBeNull();
  });

  it("rejects a symlink that points outside the repo", () => {
    symlinkSync(outside, path.join(root, "backend", "tests", "escape"));
    expect(toRepoRelative(root, "backend/tests/escape/x.test.ts")).toBeNull();
  });

  it("rejects a dangling symlink that would be created outside the repo", () => {
    symlinkSync(
      path.join(outside, "missing.ts"),
      path.join(root, "backend", "tests", "dangling.test.ts"),
    );
    expect(toRepoRelative(root, "backend/tests/dangling.test.ts")).toBeNull();
  });

  it("follows a symlink that stays inside the repo", () => {
    symlinkSync(path.join(root, "backend", "tests"), path.join(root, "alias"));
    expect(toRepoRelative(root, "alias/a.test.ts")).toBe(
      "backend/tests/a.test.ts",
    );
  });
});

describe("isWritable", () => {
  const policy = {
    writable: ["backend/tests/**/*.test.ts", "frontend/src/**/*.test.tsx"],
    forbidden: ["**/node_modules/**", ".github/**", "**/*.config.*"],
  };

  it.each([
    "backend/tests/a.test.ts",
    "backend/tests/deep/dir/a.test.ts",
    "frontend/src/components/Card.test.tsx",
  ])("allows %s", (rel) => {
    expect(isWritable(rel, policy)).toBe(true);
  });

  it.each([
    "backend/src/app.ts",
    "backend/tests/a.ts",
    ".github/workflows/ci.yml",
    "backend/tests/node_modules/pkg/x.test.ts",
    "backend/vitest.config.ts",
  ])("refuses %s", (rel) => {
    expect(isWritable(rel, policy)).toBe(false);
  });

  it("lets a forbidden glob win over a writable one", () => {
    expect(
      isWritable("backend/tests/a.test.ts", {
        writable: ["backend/tests/**"],
        forbidden: ["**/*.test.ts"],
      }),
    ).toBe(false);
  });

  it("matches dot directories", () => {
    expect(
      isWritable("backend/tests/.hidden/a.test.ts", {
        writable: ["backend/tests/**/*.test.ts"],
        forbidden: [],
      }),
    ).toBe(true);
  });

  it("does not expand glob characters in the path", () => {
    expect(isWritable("backend/tests/*.test.ts", policy)).toBe(true);
    expect(isWritable("backend/src/**", policy)).toBe(false);
  });
});

describe("the policy in config.json", () => {
  const { policy } = loadConfig(
    fileURLToPath(new URL("../../config.json", import.meta.url)),
  );

  it.each([
    "backend/tests/users.test.ts",
    "backend/tests/fixture.ts",
    "frontend/src/Card.test.tsx",
    "frontend/src/test/todoFixture.ts",
  ])("allows %s", (rel) => {
    expect(isWritable(rel, policy)).toBe(true);
  });

  it.each([
    "frontend/src/test/setup.ts",
    "backend/vitest.config.ts",
    "agents/agent-pr-tests/config.json",
    ".github/workflows/pr-unit-tests.yml",
  ])("refuses %s", (rel) => {
    expect(isWritable(rel, policy)).toBe(false);
  });
});
