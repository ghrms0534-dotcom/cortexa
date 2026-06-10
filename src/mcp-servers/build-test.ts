import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detectBuildProject, getBuildCommand, getTestCommand } from "../shared/build-system.js";
import { getWorkspaceRoot } from "../shared/workspace.js";

const execAsync = promisify(exec);

const server = new McpServer({
  name: "build-test-server",
  version: "1.0.0"
});

function resolveWorkspaceCwd(cwd?: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const resolvedCwd = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;

  if (!resolvedCwd.startsWith(workspaceRoot)) {
    throw new Error("Build/Test cwd escapes the workspace root.");
  }

  return resolvedCwd;
}

async function runBuildTool(command: string, cwd: string): Promise<{
  stdout: string;
  stderr: string;
}> {
  const result = await execAsync(command, {
    cwd,
    shell: "powershell.exe",
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function executeBuildOrTest(action: "build" | "test", cwd?: string) {
  let resolvedCwd: string;
  try {
    resolvedCwd = resolveWorkspaceCwd(cwd);
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Invalid working directory."
    };
  }

  const workspaceRoot = getWorkspaceRoot();
  const detectedProject = await detectBuildProject(resolvedCwd, workspaceRoot);

  if (!detectedProject) {
    return {
      ok: false as const,
      message: "Could not detect a Gradle or Maven project in the workspace."
    };
  }

  let command: string;
  try {
    command = action === "build"
      ? getBuildCommand(detectedProject)
      : getTestCommand(detectedProject);
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Failed to determine the build/test command.",
      data: {
        buildSystem: detectedProject.type,
        projectRoot: path.relative(workspaceRoot, detectedProject.projectRoot) || "."
      }
    };
  }

  try {
    const data = await runBuildTool(command, detectedProject.projectRoot);
    return {
      ok: true as const,
      message: action === "build" ? "Project build completed." : "Project tests completed.",
      data: {
        buildSystem: detectedProject.type,
        projectRoot: path.relative(workspaceRoot, detectedProject.projectRoot) || ".",
        command,
        ...data
      }
    };
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error && typeof error.stdout === "string"
      ? error.stdout.trim()
      : "";
    const stderr = typeof error === "object" && error && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";
    const message = error instanceof Error ? error.message : `${action} command failed.`;
    return {
      ok: false as const,
      message,
      data: {
        buildSystem: detectedProject.type,
        projectRoot: path.relative(workspaceRoot, detectedProject.projectRoot) || ".",
        command,
        stdout,
        stderr
      }
    };
  }
}

server.registerTool(
  "build_project",
  {
    description: "Detect a supported project in the workspace and run its build command from the current workspace root.",
    inputSchema: {
      cwd: z.string().optional()
    }
  },
  async ({ cwd }) => {
    const result = await executeBuildOrTest("build", cwd);
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
  "run_tests",
  {
    description: "Detect a supported project in the workspace and run its test command from the current workspace root.",
    inputSchema: {
      cwd: z.string().optional()
    }
  },
  async ({ cwd }) => {
    const result = await executeBuildOrTest("test", cwd);
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
  console.error("build-test server failed:", error);
  process.exit(1);
});
