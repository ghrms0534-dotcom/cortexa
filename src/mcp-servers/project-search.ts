import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  findFilesByName,
  listProjectEntries,
  projectPathExists,
  readProjectFile,
  searchProject,
  writeProjectFile
} from "../shared/project-search.js";

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
  "path_exists",
  {
    description: "Check whether a workspace-relative file or directory exists.",
    inputSchema: {
      path: z.string().min(1)
    }
  },
  async ({ path }) => {
    try {
      const result = await projectPathExists(path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              message: result.exists ? `Path exists: ${path}` : `Path not found: ${path}`,
              data: result
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
              message: error instanceof Error ? error.message : "Failed to check path existence."
            })
          }
        ]
      };
    }
  }
);

server.registerTool(
  "list_project_entries",
  {
    description: "List files and directories inside a workspace-relative directory. Use path='.' for the workspace root.",
    inputSchema: {
      path: z.string().optional()
    }
  },
  async ({ path }) => {
    try {
      const entries = await listProjectEntries(path ?? ".");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              message: `Listed ${entries.length} entries.`,
              data: entries
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
              message: error instanceof Error ? error.message : "Failed to list project entries."
            })
          }
        ]
      };
    }
  }
);

server.registerTool(
  "find_files_by_name",
  {
    description: "Find files or directories by partial name anywhere in the current workspace.",
    inputSchema: {
      name: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional()
    }
  },
  async ({ name, limit }) => {
    try {
      const matches = await findFilesByName(name, limit ?? 50);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              message: `Found ${matches.length} entries by name.`,
              data: matches
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
              message: error instanceof Error ? error.message : "Failed to find files by name."
            })
          }
        ]
      };
    }
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

server.registerTool(
  "write_project_file",
  {
    description: "Write the contents of a project file by relative path inside the current workspace.",
    inputSchema: {
      path: z.string().min(1),
      content: z.string()
    }
  },
  async ({ path, content }) => {
    try {
      await writeProjectFile(path, content);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              message: `Wrote ${path}.`
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
              message: error instanceof Error ? error.message : "Failed to write project file."
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
