import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { getWorkspaceRoot, resolveWorkspacePath } from "./workspace.js";

const ignoredDirs = new Set([
  ".git",
  ".gradle",
  "build",
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "target"
]);

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

export async function projectPathExists(relativePath: string): Promise<{
  exists: boolean;
  path: string;
  type?: "file" | "directory";
}> {
  const normalized = path.normalize(relativePath);
  const fullPath = resolveWorkspacePath(normalized);

  try {
    const stats = await stat(fullPath);
    return {
      exists: true,
      path: normalized,
      type: stats.isDirectory() ? "directory" : "file"
    };
  } catch {
    return {
      exists: false,
      path: normalized
    };
  }
}

export async function listProjectEntries(relativeDir = "."): Promise<Array<{ name: string; path: string; type: "file" | "directory" }>> {
  const normalized = path.normalize(relativeDir);
  const targetDir = resolveWorkspacePath(normalized);
  const workspaceRoot = getWorkspaceRoot();
  const entries = await readdir(targetDir, { withFileTypes: true });

  return entries
    .filter((entry) => !ignoredDirs.has(entry.name))
    .map((entry) => {
      const fullPath = path.join(targetDir, entry.name);
      return {
        name: entry.name,
        path: path.relative(workspaceRoot, fullPath) || entry.name,
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const)
      };
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

export async function findFilesByName(name: string, limit = 50): Promise<Array<{ path: string; type: "file" | "directory" }>> {
  const workspaceRoot = getWorkspaceRoot();
  const needle = name.toLowerCase();
  const results: Array<{ path: string; type: "file" | "directory" }> = [];

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
      const relativePath = path.relative(workspaceRoot, fullPath) || entry.name;

      if (entry.name.toLowerCase().includes(needle)) {
        results.push({
          path: relativePath,
          type: entry.isDirectory() ? "directory" : "file"
        });
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(workspaceRoot);
  return results;
}

export async function readProjectFile(relativeFilePath: string, maxChars = 4000): Promise<string> {
  const normalized = path.normalize(relativeFilePath);
  const fullPath = resolveWorkspacePath(normalized);
  const content = await readFile(fullPath, "utf8");
  return content.slice(0, maxChars);
}

export async function writeProjectFile(relativeFilePath: string, content: string): Promise<void> {
  const normalized = path.normalize(relativeFilePath);
  const fullPath = resolveWorkspacePath(normalized);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}
