import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getWorkspaceRoot } from "../shared/workspace.js";

const execAsync = promisify(exec);

const server = new McpServer({
  name: "git-server",
  version: "1.0.0"
});

function resolveWorkspaceCwd(cwd?: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const resolvedCwd = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;

  if (!resolvedCwd.startsWith(workspaceRoot)) {
    throw new Error("Git cwd escapes the workspace root.");
  }

  return resolvedCwd;
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runGitCommand(command: string, cwd?: string): Promise<{
  ok: true;
  message: string;
  data: {
    stdout: string;
    stderr: string;
  };
} | {
  ok: false;
  message: string;
}> {
  let resolvedCwd: string;

  try {
    resolvedCwd = resolveWorkspaceCwd(cwd);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid Git cwd."
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
      ok: true,
      message: "Git command completed.",
      data: {
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git command failed.";
    return {
      ok: false,
      message
    };
  }
}

server.registerTool(
  "git_status",
  {
    description: "Show the current Git working tree status for the workspace.",
    inputSchema: {
      cwd: z.string().optional(),
      short: z.boolean().optional()
    }
  },
  async ({ cwd, short }) => {
    const command = short ? "git status --short" : "git status";
    const result = await runGitCommand(command, cwd);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ]
    };
  }
);

server.registerTool(
  "git_diff",
  {
    description: "Show Git diff output for the workspace or a specific file.",
    inputSchema: {
      cwd: z.string().optional(),
      path: z.string().optional(),
      staged: z.boolean().optional()
    }
  },
  async ({ cwd, path: targetPath, staged }) => {
    const args = ["git diff"];

    if (staged) {
      args.push("--staged");
    }

    if (targetPath) {
      args.push("--");
      args.push(quotePowerShellSingle(targetPath));
    }

    const result = await runGitCommand(args.join(" "), cwd);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ]
    };
  }
);

server.registerTool(
  "git_log",
  {
    description: "Show recent Git commit history for the workspace.",
    inputSchema: {
      cwd: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional()
    }
  },
  async ({ cwd, limit }) => {
    const commitLimit = limit ?? 10;
    const command = `git log --oneline -n ${commitLimit}`;
    const result = await runGitCommand(command, cwd);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
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
  console.error("git server failed:", error);
  process.exit(1);
});
