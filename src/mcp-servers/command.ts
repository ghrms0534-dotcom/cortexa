import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detectRisk } from "../shared/risk.js";

const execAsync = promisify(exec);

const server = new McpServer({
  name: "command-server",
  version: "1.0.0"
});

server.registerTool(
  "run_command",
  {
    description: "Run a local PowerShell command inside the workspace. Risky commands require approval.",
    inputSchema: {
      command: z.string().min(1),
      approved: z.boolean().optional(),
      cwd: z.string().optional()
    }
  },
  async ({ command, approved, cwd }) => {
    const risk = detectRisk(command);
    if (risk && !approved) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              message: "Approval required before this command can run.",
              approval: {
                approvalRequired: true,
                reason: risk,
                originalArgs: {
                  command,
                  cwd
                }
              }
            })
          }
        ]
      };
    }

    const workspaceRoot = path.resolve(process.env.AGENT_WORKSPACE_ROOT ?? process.cwd());
    const resolvedCwd = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;

    if (!resolvedCwd.startsWith(workspaceRoot)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              message: "Command cwd escapes the workspace root."
            })
          }
        ]
      };
    }

    try {
      const result = await execAsync(command, {
        cwd: resolvedCwd,
        shell: "powershell.exe",
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              message: "Command completed.",
              data: {
                stdout: result.stdout.trim(),
                stderr: result.stderr.trim()
              }
            })
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed.";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              message
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
  console.error("command server failed:", error);
  process.exit(1);
});
