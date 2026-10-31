import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/agent/command.ts";

const node = (script: string, timeout = 10_000) =>
  runCommand(process.execPath, ["-e", script], { cwd: process.cwd(), timeout });

describe("runCommand", () => {
  it("returns exit code 0 and the combined output of a command that succeeds", async () => {
    const result = await node("console.log('out'); console.error('err')");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });

  it("returns the exit code of a command that fails", async () => {
    const result = await node("console.error('boom'); process.exit(3)");
    expect(result).toMatchObject({ exitCode: 3, output: "boom\n" });
  });

  it("counts a process that a signal killed as a failure", async () => {
    const result = await node("process.kill(process.pid, 'SIGKILL')");
    expect(result.exitCode).toBe(1);
  });

  it("counts a missing binary as a failure and says why", async () => {
    const result = await runCommand("no-such-binary-for-tests", [], {
      cwd: process.cwd(),
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("ENOENT");
  });

  it("counts a command that outlives its timeout as a failure", async () => {
    const result = await node("setTimeout(() => {}, 30_000)", 200);
    expect(result.exitCode).toBe(1);
  });

  it("passes arguments to the command without a shell", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "console.log(process.argv[1])", "$(echo hi); *"],
      { cwd: process.cwd(), timeout: 10_000 },
    );
    expect(result.output).toBe("$(echo hi); *\n");
  });
});
