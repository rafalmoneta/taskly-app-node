import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import type { AgentConfig } from "../config.ts";

type WritePolicy = Pick<AgentConfig["policy"], "writable" | "forbidden">;

// Pi's file tools expand these to somewhere else before use.
const EXPANDED_BY_PI = /^(~(\/|$)|file:\/\/)/;

// Pi's file tools turn these into plain spaces, which names a different path
// than the one this module checks.
const SPACES_NORMALIZED_BY_PI = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/;

function hasEntry(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function realpathAllowingMissing(target: string): string | null {
  let ancestor = target;
  while (!hasEntry(ancestor)) {
    ancestor = path.dirname(ancestor);
  }
  try {
    return path.join(realpathSync(ancestor), path.relative(ancestor, target));
  } catch {
    return null; // a dangling symlink
  }
}

/** The POSIX path relative to `root`, "" for the root itself, or null outside the repository. */
export function toRepoRelative(root: string, input: string): string | null {
  const requested = input.replace(/^@/, "");
  if (EXPANDED_BY_PI.test(requested) || SPACES_NORMALIZED_BY_PI.test(input)) {
    return null;
  }

  const real = realpathAllowingMissing(path.resolve(root, requested));
  if (real === null) return null;

  const relative = path.relative(realpathSync(root), real);
  const leavesRepo =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return leavesRepo ? null : relative.split(path.sep).join("/");
}

export function isWritable(rel: string, policy: WritePolicy): boolean {
  const matches = (glob: string) => minimatch(rel, glob, { dot: true });
  return policy.writable.some(matches) && !policy.forbidden.some(matches);
}
