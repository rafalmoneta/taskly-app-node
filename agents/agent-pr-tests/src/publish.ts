import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isWritable } from "./agent/policy.ts";
import { OUTCOMES, type RunResult } from "./agent/result.ts";
import { loadConfig } from "./config.ts";
import { CI_RESULTS, type CiResult, renderReport } from "./publish/comment.ts";

const USAGE =
  "Usage: node src/publish.ts check | report <result.json> [--pushed] [--ci <result>] [--run-url <url>]";

// One entry of `git diff --raw -z`: ":<old mode> <new mode> <old id> <new id> <status>\0<path>\0".
const RAW_ENTRY = /^:\d{6} (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])$/;

interface StagedChange {
  status: string;
  mode: string;
  path: string;
}

function parseRawDiff(raw: string): StagedChange[] | null {
  const fields = raw.split("\0");
  if (fields.pop() !== "") return null;

  const changes: StagedChange[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const entry = RAW_ENTRY.exec(fields[i]);
    const path = fields[i + 1];
    if (!entry || path === undefined) return null;
    changes.push({ mode: entry[1], status: entry[2], path });
  }
  return changes;
}

function check(): number {
  const { policy } = loadConfig(
    fileURLToPath(new URL("../config.json", import.meta.url)),
  );
  const changes = parseRawDiff(readFileSync(0, "utf8"));
  if (!changes) {
    console.log("::error::Unrecognized output of git diff --raw -z");
    return 1;
  }

  const errors: string[] = [];
  for (const { status, mode, path } of changes) {
    // JSON.stringify keeps a newline in a file name from starting a workflow command.
    const name = JSON.stringify(path);
    if (!isWritable(path, policy)) {
      errors.push(`The test agent may not change ${name}`);
    }
    if (!(status === "A" || status === "M") || mode !== "100644") {
      errors.push(
        `The test agent may only add or edit regular files, not ${name} (status ${status}, mode ${mode})`,
      );
    }
  }
  if (changes.length > policy.maxFilesPerRun) {
    errors.push(
      `The test agent changed ${changes.length} files, more than the ${policy.maxFilesPerRun} it may change`,
    );
  }
  for (const error of errors) console.log(`::error::${error}`);
  return errors.length > 0 ? 1 : 0;
}

function isRunResult(value: unknown): value is RunResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "outcome" in value &&
    typeof value.outcome === "string" &&
    Object.hasOwn(OUTCOMES, value.outcome)
  );
}

function readResult(file: string): RunResult | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRunResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCiResult(value: string): value is CiResult {
  return (CI_RESULTS as readonly string[]).includes(value);
}

function parseReportArgs(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        pushed: { type: "boolean", default: false },
        ci: { type: "string", default: "skipped" },
        "run-url": { type: "string" },
      },
      allowPositionals: true,
    });
    if (positionals.length !== 1 || !isCiResult(values.ci)) return undefined;
    return {
      file: positionals[0],
      pushed: values.pushed,
      ci: values.ci,
      runUrl: values["run-url"],
    };
  } catch {
    return undefined;
  }
}

function report(args: string[]): number {
  const options = parseReportArgs(args);
  if (!options) {
    console.error(USAGE);
    return 2;
  }

  const { markdown, conclusion, title } = renderReport(
    readResult(options.file),
    { pushed: options.pushed, ci: options.ci, runUrl: options.runUrl },
  );
  process.stdout.write(markdown);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `conclusion=${conclusion}\ntitle=${title}\n`,
    );
  }
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "check" && rest.length === 0) {
  process.exitCode = check();
} else if (command === "report") {
  process.exitCode = report(rest);
} else {
  console.error(USAGE);
  process.exitCode = 2;
}
