import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type WorkspaceState = {
  currentWorkspaceRoot: string;
};

function readWorkspaceStateFile(): WorkspaceState | null {
  const stateFile = getWorkspaceStateFile();
  if (!existsSync(stateFile)) {
    return null;
  }

  try {
    const raw = readFileSync(stateFile, "utf8");
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return null;
  }
}

export function getAgentRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function getWorkspaceStateFile(): string {
  return path.join(getAgentRoot(), ".agent", "workspace-state.json");
}

export function getDefaultWorkspaceRoot(): string {
  return path.resolve(process.env.AGENT_WORKSPACE_ROOT ?? process.cwd());
}

export function getWorkspaceRoot(): string {
  const storedState = readWorkspaceStateFile();
  return path.resolve(storedState?.currentWorkspaceRoot ?? getDefaultWorkspaceRoot());
}

export function setWorkspaceRoot(nextWorkspaceRoot: string): string {
  const resolvedWorkspaceRoot = path.resolve(nextWorkspaceRoot);
  const stateFile = getWorkspaceStateFile();
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify(
      {
        currentWorkspaceRoot: resolvedWorkspaceRoot
      },
      null,
      2
    ),
    "utf8"
  );
  return resolvedWorkspaceRoot;
}

export function resolveWorkspacePath(relativePath = "."): string {
  const workspaceRoot = getWorkspaceRoot();
  const resolvedPath = path.resolve(workspaceRoot, relativePath);

  if (!resolvedPath.startsWith(workspaceRoot)) {
    throw new Error("Path escapes the workspace root.");
  }

  return resolvedPath;
}

export function getBuiltServerScript(name: string): string {
  return path.join(getAgentRoot(), "dist", "mcp-servers", `${name}.js`);
}
