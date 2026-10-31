import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeApiKey } from "../../src/agent/api-key.ts";

let keyFile: string;

beforeEach(() => {
  keyFile = path.join(mkdtempSync(path.join(tmpdir(), "api-key-")), "key");
});

afterEach(() => {
  rmSync(path.dirname(keyFile), { recursive: true, force: true });
});

describe("takeApiKey", () => {
  it("returns the key without surrounding whitespace and deletes the file", () => {
    writeFileSync(keyFile, "sk-ant-secret\n");

    expect(takeApiKey(keyFile)).toBe("sk-ant-secret");
    expect(existsSync(keyFile)).toBe(false);
  });

  it.each(["", " \n"])(
    "refuses an empty key %j and still deletes the file",
    (content) => {
      writeFileSync(keyFile, content);

      expect(() => takeApiKey(keyFile)).toThrow(/is empty/);
      expect(existsSync(keyFile)).toBe(false);
    },
  );

  it("fails when the file is missing", () => {
    expect(() => takeApiKey(keyFile)).toThrow(/ENOENT/);
  });
});
