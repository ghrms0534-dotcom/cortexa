import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

export type BuildSystemType = "gradle" | "maven" | "npm";

export type DetectedBuildProject = {
  type: BuildSystemType;
  projectRoot: string;
  buildCommand: string | null;
  testCommand: string | null;
  descriptor: string;
};

const excludedDirectoryNames = new Set([
  ".git",
  ".idea",
  ".next",
  ".nuxt",
  ".turbo",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target"
]);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingFile(directory: string, filenames: string[]): Promise<string | null> {
  for (const filename of filenames) {
    if (await pathExists(path.join(directory, filename))) {
      return filename;
    }
  }

  return null;
}

async function detectPackageManager(directory: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  if (await pathExists(path.join(directory, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (await pathExists(path.join(directory, "yarn.lock"))) {
    return "yarn";
  }

  if (await pathExists(path.join(directory, "bun.lockb")) || await pathExists(path.join(directory, "bun.lock"))) {
    return "bun";
  }

  return "npm";
}

async function detectNodeProject(directory: string): Promise<DetectedBuildProject | null> {
  const packageJsonPath = path.join(directory, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const packageManager = await detectPackageManager(directory);
    const runScriptPrefix = `${packageManager} run`;

    return {
      type: "npm",
      projectRoot: directory,
      buildCommand: scripts.build ? `${runScriptPrefix} build` : null,
      testCommand: scripts.test ? `${runScriptPrefix} test` : null,
      descriptor: "package.json"
    };
  } catch {
    return {
      type: "npm",
      projectRoot: directory,
      buildCommand: null,
      testCommand: null,
      descriptor: "package.json"
    };
  }
}

async function detectBuildProjectInDirectory(directory: string): Promise<DetectedBuildProject | null> {
  const gradleWrapper = await firstExistingFile(directory, ["gradlew.bat", "gradlew"]);
  if (gradleWrapper) {
    const wrapper = `.\\${gradleWrapper}`;
    return {
      type: "gradle",
      projectRoot: directory,
      buildCommand: `${wrapper} assemble`,
      testCommand: `${wrapper} test`,
      descriptor: gradleWrapper
    };
  }

  const mavenWrapper = await firstExistingFile(directory, ["mvnw.cmd", "mvnw"]);
  if (mavenWrapper) {
    const wrapper = `.\\${mavenWrapper}`;
    return {
      type: "maven",
      projectRoot: directory,
      buildCommand: `${wrapper} package -DskipTests`,
      testCommand: `${wrapper} test`,
      descriptor: mavenWrapper
    };
  }

  const nodeProject = await detectNodeProject(directory);
  if (nodeProject) {
    return nodeProject;
  }

  return null;
}

async function collectCandidateDirectories(startDirectory: string, workspaceRoot: string): Promise<string[]> {
  const candidates: string[] = [];
  const discovered = new Set<string>();
  const processed = new Set<string>();

  let currentDirectory = path.resolve(startDirectory);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

  while (currentDirectory.startsWith(resolvedWorkspaceRoot)) {
    if (!discovered.has(currentDirectory)) {
      candidates.push(currentDirectory);
      discovered.add(currentDirectory);
    }

    if (currentDirectory === resolvedWorkspaceRoot) {
      break;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  const queue: string[] = [resolvedWorkspaceRoot];

  while (queue.length > 0) {
    const directory = queue.shift();
    if (!directory || processed.has(directory)) {
      continue;
    }

    processed.add(directory);

    if (!discovered.has(directory)) {
      discovered.add(directory);
      candidates.push(directory);
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || excludedDirectoryNames.has(entry.name)) {
        continue;
      }

      const childDirectory = path.join(directory, entry.name);
      if (!processed.has(childDirectory)) {
        queue.push(childDirectory);
      }
    }
  }

  return candidates;
}

export async function detectBuildProject(startDirectory: string, workspaceRoot: string): Promise<DetectedBuildProject | null> {
  const candidates = await collectCandidateDirectories(startDirectory, workspaceRoot);

  for (const directory of candidates) {
    const detected = await detectBuildProjectInDirectory(directory);
    if (detected) {
      return detected;
    }
  }

  return null;
}

export function getBuildCommand(project: DetectedBuildProject): string {
  if (!project.buildCommand) {
    throw new Error(`Detected ${project.type} project at ${project.projectRoot}, but no build command is available.`);
  }

  return project.buildCommand;
}

export function getTestCommand(project: DetectedBuildProject): string {
  if (!project.testCommand) {
    throw new Error(`Detected ${project.type} project at ${project.projectRoot}, but no test command is available.`);
  }

  return project.testCommand;
}
