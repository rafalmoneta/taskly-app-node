import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ReportSchema } from "../../src/agent/report.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "report_result",
    label: "Report result",
    description:
      "Submit the final result of this run. Call it once, as the last action, after the full test run.",
    promptSnippet: "Submit the final result (required last step)",
    promptGuidelines: [
      "Call report_result once as the final action of a run. Never end with plain text instead.",
    ],
    parameters: ReportSchema,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Result recorded." }],
        details: params,
        terminate: true,
      };
    },
  });
}
