import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage"
]);

function getWorkspaceRoot(): string {
  return path.resolve(process.env.AGENT_WORKSPACE_ROOT ?? process.cwd());
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function searchProject(query: string, limit = 20): Promise<Array<{ path: string; preview: string }>> {
  const results: Array<{ path: string; preview: string }> = [];
  const workspaceRoot = getWorkspaceRoot();
  const needle = query.toLowerCase();

  async function walk(dirPath: string): Promise<void> {
    if (results.length >= limit) {
      return;
    }

    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }

      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(workspaceRoot, fullPath);
      if (relativePath.toLowerCase().includes(needle)) {
        results.push({ path: relativePath, preview: "Matched in file path" });
        continue;
      }

      const statSafe = await pathExists(fullPath);
      if (!statSafe) {
        continue;
      }

      const content = await readFile(fullPath, "utf8").catch(() => "");
      const lower = content.toLowerCase();
      const index = lower.indexOf(needle);

      if (index >= 0) {
        const start = Math.max(0, index - 80);
        const end = Math.min(content.length, index + 160);
        const preview = content.slice(start, end).replace(/\s+/g, " ").trim();
        results.push({ path: relativePath, preview });
      }
    }
  }

  await walk(workspaceRoot);
  return results;
}

export async function readProjectFile(relativeFilePath: string, maxChars = 4000): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const normalized = path.normalize(relativeFilePath);
  const fullPath = path.resolve(workspaceRoot, normalized);

  if (!fullPath.startsWith(workspaceRoot)) {
    throw new Error("Path escapes the workspace root.");
  }

  const content = await readFile(fullPath, "utf8");
  return content.slice(0, maxChars);
}
