// File path: ./src/services/mcpClient.ts

export interface MCPPayload {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface MCPResponse<T = unknown> {
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class MCPClient {
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:9100/mcp') {
    this.endpoint = endpoint;
  }

  public async send<T = unknown>(payload: MCPPayload): Promise<MCPResponse<T>> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`MCP transport error: ${response.statusText}`);
    }

    return (await response.json()) as MCPResponse<T>;
  }
}

export const defaultMCPClient = new MCPClient();