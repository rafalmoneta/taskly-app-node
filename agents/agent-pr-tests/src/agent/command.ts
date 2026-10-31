import { execFile } from "node:child_process";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface CommandResult {
  exitCode: number;
  output: string;
}

/**
 * Runs a command without a shell. A signal, a missing binary and a timeout all
 * give exit code 1, because Pi's `pi.exec` reports a process that a signal
 * killed as exit code 0.
 */
export function runCommand(
  command: string,
  args: string[],
  { cwd, timeout }: { cwd: string; timeout: number },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error === null) return resolve({ exitCode: 0, output });
        if (typeof error.code === "number") {
          return resolve({ exitCode: error.code, output });
        }
        resolve({ exitCode: 1, output: `${output}\n${error.message}` });
      },
    );
  });
}
