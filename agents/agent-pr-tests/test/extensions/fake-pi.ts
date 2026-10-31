import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export type Exec = (
  command: string,
  args: string[],
  options: ExecOptions & { cwd: string },
) => Promise<ExecResult>;

type Handler = (event: unknown, ctx: unknown) => unknown;

export async function loadExtension(
  extension: ExtensionFactory,
  exec: Exec = async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
) {
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Handler[]>();
  const sendMessage = vi.fn();
  const pi = {
    exec,
    sendMessage,
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on: (event: string, handler: Handler) =>
      handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as ExtensionAPI;
  await extension(pi);

  return {
    sendMessage,
    async callTool(name: string, params: unknown, cwd: string) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      return tool.execute("call-1", params, undefined, undefined, {
        cwd,
      } as never);
    },
    emit(event: string, payload: unknown, ctx: unknown = {}) {
      for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
    },
  };
}
