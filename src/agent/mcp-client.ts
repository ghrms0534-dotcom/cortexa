import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ServerConfig = {
  name: string;
  command: string;
  args: string[];
};

export type ConnectedTool = {
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<unknown>;
};

export class MultiMcpClient {
  private readonly clients: Client[] = [];
  private readonly configs: ServerConfig[];

  constructor(configs: ServerConfig[]) {
    this.configs = configs;
  }

  async connect(): Promise<ConnectedTool[]> {
    const connectedTools: ConnectedTool[] = [];

    for (const config of this.configs) {
      const client = new Client({
        name: `agent-client-${config.name}`,
        version: "1.0.0"
      });
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args
      });

      await client.connect(transport);
      this.clients.push(client);

      const toolsResponse = await client.listTools();
      for (const tool of toolsResponse.tools) {
        connectedTools.push({
          serverName: config.name,
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
          call: async (args: Record<string, unknown>) => {
            return client.callTool({
              name: tool.name,
              arguments: args
            });
          }
        });
      }
    }

    return connectedTools;
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.close()));
  }
}
