import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PR_SKILL, parsePrNumber, prPrompt } from "../../src/agent/task.ts";

describe("PR task", () => {
  it("invokes the PR skill with the PR number", () => {
    expect(prPrompt(parsePrNumber("42"))).toBe("/skill:pr-unit-tests 42");
  });

  it("names a skill that exists in the agent directory", () => {
    const skill = new URL(
      `../../pi/skills/${PR_SKILL}/SKILL.md`,
      import.meta.url,
    );
    expect(existsSync(fileURLToPath(skill))).toBe(true);
  });

  it.each([undefined, "", "abc", "0", "-3", "4.5", "42; rm -rf /"])(
    "rejects PR number %j",
    (pr) => {
      expect(() => parsePrNumber(pr)).toThrow(/--pr/);
    },
  );
});
