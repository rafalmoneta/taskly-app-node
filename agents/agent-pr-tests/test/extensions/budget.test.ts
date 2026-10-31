import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import budget from "../../pi/extensions/budget.ts";
import { loadConfig } from "../../src/config.ts";
import { loadExtension } from "./fake-pi.ts";

const { softTurns, hardTurns, softUsd, hardUsd } = loadConfig(
  path.join(fileURLToPath(new URL("../../", import.meta.url)), "config.json"),
).roles.pr;

const assistantMessage = (costUsd: number) => ({
  message: { role: "assistant", usage: { cost: { total: costUsd } } },
});

async function startRun() {
  const extension = await loadExtension(budget);
  const ctx = { abort: vi.fn() };
  const endTurn = (costUsd = 0) => {
    extension.emit("message_end", assistantMessage(costUsd));
    extension.emit("turn_end", {}, ctx);
  };
  return { ...extension, ctx, endTurn };
}

describe("budget", () => {
  it("lets a run below the soft limits alone", async () => {
    const run = await startRun();
    for (let turn = 1; turn < softTurns; turn++) run.endTurn(0);

    expect(run.sendMessage).not.toHaveBeenCalled();
    expect(run.ctx.abort).not.toHaveBeenCalled();
  });

  it("tells the model to wrap up once, at the soft turn limit", async () => {
    const run = await startRun();
    for (let turn = 1; turn <= softTurns + 3; turn++) run.endTurn(0);

    expect(run.sendMessage).toHaveBeenCalledTimes(1);
    expect(run.sendMessage.mock.calls[0][1]).toEqual({ deliverAs: "steer" });
    expect(run.ctx.abort).not.toHaveBeenCalled();
  });

  it("warns at the soft cost limit", async () => {
    const run = await startRun();
    run.endTurn(softUsd);

    expect(run.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("aborts at the hard turn limit", async () => {
    const run = await startRun();
    for (let turn = 1; turn < hardTurns; turn++) run.endTurn(0);
    expect(run.ctx.abort).not.toHaveBeenCalled();

    run.endTurn(0);
    expect(run.ctx.abort).toHaveBeenCalled();
  });

  it("aborts at the hard cost limit", async () => {
    const run = await startRun();
    run.endTurn(hardUsd);

    expect(run.ctx.abort).toHaveBeenCalled();
  });
});
