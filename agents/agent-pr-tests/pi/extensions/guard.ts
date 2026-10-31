import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  isToolCallEventType,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isWritable, toRepoRelative } from "../../src/agent/policy.ts";
import { loadConfig } from "../../src/config.ts";

export default function (pi: ExtensionAPI) {
  const { policy } = loadConfig(
    fileURLToPath(new URL("../../config.json", import.meta.url)),
  );
  const touched = new Set<string>();
  let violations = 0;

  function violation(reason: string): ToolCallEventResult {
    violations += 1;
    return {
      block: true,
      reason,
      terminate: violations >= policy.maxViolations,
    };
  }

  function checkWrite(
    repoRoot: string,
    target: string,
  ): ToolCallEventResult | undefined {
    const rel = toRepoRelative(repoRoot, target);
    if (rel === null || !isWritable(rel, policy)) {
      return violation(
        `Only unit test files may be created or modified. Allowed: ${policy.writable.join(", ")}. Got: ${rel ?? "a path outside the repository"}.`,
      );
    }
    if (!touched.has(rel) && touched.size >= policy.maxFilesPerRun) {
      return violation(
        `File cap reached (${policy.maxFilesPerRun} files per run). Finish the files you already touched and call report_result.`,
      );
    }
    touched.add(rel);
    return undefined;
  }

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "bash" || event.toolName === "powershell") {
      return {
        block: true,
        reason:
          "The shell is disabled in this agent. Use run_tests or typecheck instead.",
      };
    }

    if (
      isToolCallEventType("read", event) ||
      isToolCallEventType("grep", event) ||
      isToolCallEventType("find", event) ||
      isToolCallEventType("ls", event)
    ) {
      if (toRepoRelative(ctx.cwd, event.input.path ?? ".") !== null) {
        return undefined;
      }
      return {
        block: true,
        reason:
          "Reading is limited to the repository. Use a path relative to the repository root.",
      };
    }

    if (
      isToolCallEventType("write", event) ||
      isToolCallEventType("edit", event)
    ) {
      return checkWrite(ctx.cwd, event.input.path);
    }

    return undefined;
  });
}
