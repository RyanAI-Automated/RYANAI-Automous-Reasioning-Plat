import { beforeEach, describe, expect, it, vi } from "vitest";
import { RyanMCPServer } from "./ryanMcpServer.js";

type Handler = (request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) => Promise<{ isError?: boolean; tools?: Array<{ name: string }>; content?: Array<{ text: string }> }>;
const { handlers } = vi.hoisted(() => ({ handlers: [] as Handler[] }));
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class {
    setRequestHandler(_schema: unknown, handler: Handler) {
      handlers.push(handler);
    }
  },
}));
vi.mock("../engine/sandbox.js", () => ({
  RyanAISandbox: { executeInSandbox: vi.fn() },
}));
vi.mock("../tools/systemTools.js", () => ({
  systemDiagnosticsTool: {
    invoke: vi.fn(),
    schema: { parseAsync: vi.fn() },
  },
}));

beforeEach(() => {
  handlers.length = 0;
  vi.clearAllMocks();
});

describe("MCP privileged action boundary", () => {
  it("does not advertise a workspace self-patching tool", async () => {
    new RyanMCPServer();
    const result = await handlers[0]({ params: { name: "list_tools" } });
    expect(result.tools?.map((tool) => tool.name)).not.toContain("self_patch_workspace");
  });

  it("rejects legacy self-patch calls without modifying the workspace", async () => {
    new RyanMCPServer();
    const result = await handlers[1]({
      params: {
        name: "self_patch_workspace",
        arguments: { filePath: "src/app.ts", patchContent: "candidate" },
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Unknown MCP tool requested");
  });
});
