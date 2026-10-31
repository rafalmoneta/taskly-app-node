import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../src/config.ts";

export default function (pi: ExtensionAPI) {
  const { pr: role } = loadConfig(
    fileURLToPath(new URL("../../config.json", import.meta.url)),
  ).roles;
  let turns = 0;
  let costUsd = 0;
  let warned = false;

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      costUsd += event.message.usage.cost.total;
    }
  });

  pi.on("turn_end", (_event, ctx) => {
    turns += 1;

    if (turns >= role.hardTurns || costUsd >= role.hardUsd) {
      console.error(
        `[budget] hard limit reached after ${turns} turns and $${costUsd.toFixed(2)}, aborting`,
      );
      ctx.abort();
      return;
    }

    const softLimitReached = turns >= role.softTurns || costUsd >= role.softUsd;
    if (softLimitReached && !warned) {
      warned = true;
      pi.sendMessage(
        {
          customType: "budget",
          display: true,
          content: `Budget nearly used up (${turns} turns, $${costUsd.toFixed(2)}). Stop exploring. Finish the test file you are on, run the full suite with run_tests, then call report_result.`,
        },
        { deliverAs: "steer" },
      );
    }
  });
}
