import { spawnSync } from "node:child_process";

export function listChangedFiles(repoRoot: string): string[] {
  const status = spawnSync(
    "git",
    ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames"],
    { cwd: repoRoot, encoding: "utf8", shell: false },
  );
  if (status.status !== 0) {
    throw new Error(`git status failed: ${status.stderr || status.error}`);
  }
  // Each entry is "XY <path>"; -z keeps unusual file names unquoted.
  return status.stdout
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => entry.slice(3));
}
