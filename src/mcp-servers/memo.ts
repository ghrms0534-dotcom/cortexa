import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listMemos, saveMemo, searchMemos } from "../shared/memory-store.js";

const server = new McpServer({
  name: "memo-server",
  version: "1.0.0"
});

server.registerTool(
  "save_memo",
  {
    description: "Save a personal memo for later recall.",
    inputSchema: {
      content: z.string().min(1),
      tags: z.array(z.string()).optional()
    }
  },
  async ({ content, tags }) => {
    const item = await saveMemo(content, tags ?? []);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Saved memo ${item.id}.`,
            data: item
          })
        }
      ]
    };
  }
);

server.registerTool(
  "list_memos",
  {
    description: "List recent personal memos.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional()
    }
  },
  async ({ limit }) => {
    const items = await listMemos(limit ?? 10);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Found ${items.length} memos.`,
            data: items
          })
        }
      ]
    };
  }
);

server.registerTool(
  "search_memos",
  {
    description: "Search personal memos by keyword.",
    inputSchema: {
      query: z.string().min(1)
    }
  },
  async ({ query }) => {
    const items = await searchMemos(query);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Found ${items.length} memo matches.`,
            data: items
          })
        }
      ]
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("memo server failed:", error);
  process.exit(1);
});
