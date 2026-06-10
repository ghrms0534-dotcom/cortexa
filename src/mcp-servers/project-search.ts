import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readProjectFile, searchProject } from "../shared/project-search.js";

const server = new McpServer({
  name: "project-search-server",
  version: "1.0.0"
});

server.registerTool(
  "search_project",
  {
    description: "Search the local project for files or text such as Controller, errors, configs, or code patterns.",
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional()
    }
  },
  async ({ query, limit }) => {
    const matches = await searchProject(query, limit ?? 20);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Found ${matches.length} project matches.`,
            data: matches
          })
        }
      ]
    };
  }
);

server.registerTool(
  "read_project_file",
  {
    description: "Read the contents of a project file by relative path.",
    inputSchema: {
      path: z.string().min(1),
      maxChars: z.number().int().min(200).max(20000).optional()
    }
  },
  async ({ path, maxChars }) => {
    try {
      const content = await readProjectFile(path, maxChars ?? 4000);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              message: `Read ${path}.`,
              data: { path, content }
            })
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              message: error instanceof Error ? error.message : "Failed to read project file."
            })
          }
        ]
      };
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("project-search server failed:", error);
  process.exit(1);
});
