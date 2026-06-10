import "dotenv/config";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { appendConversationSummary } from "../shared/memory-store.js";
import { constants } from "node:fs";
import { getBuiltServerScript, getWorkspaceRoot, setWorkspaceRoot } from "../shared/workspace.js";
import { requestApproval } from "./approval.js";
import { buildMemoryContext } from "./memory-context.js";
import { MultiMcpClient, type ConnectedTool } from "./mcp-client.js";
import type { ToolJsonResult } from "../shared/types.js";

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string;
      tool_calls?: Array<{
        type: "function";
        function: {
          name: string;
          arguments: Record<string, unknown>;
        };
      }>;
    }
  | {
      role: "tool";
      tool_name: string;
      content: string;
    };

type OllamaToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaChatResponse = {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      type?: "function";
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }>;
  };
  done?: boolean;
  done_reason?: string;
};

type ToolConversationResult = {
  messages: ChatMessage[];
  finalAnswer: string;
};

const MAX_TOOL_LOOP_ITERATIONS = 8;
const MAX_AUTO_FIX_ATTEMPTS = 5;
const MAX_OLLAMA_RESPONSE_TOKENS = 256;

function getServerScript(name: string): string {
  return getBuiltServerScript(name);
}

function getSystemPrompt(memoryContext: string): string {
  const workspaceRoot = getWorkspaceRoot();
  return [
    "You are a personal MCP assistant running on Windows with a local Ollama model.",
    `Current workspace root: ${workspaceRoot}`,
    "Use tools when they would make the answer more reliable or when the user asks you to save, search, inspect, or execute something.",
    "Prefer project-search tools for workspace inspection, memo tools for memory, todo tools for tasks, build-test tools for project builds/tests, and command tools for local shell work.",
    "When the user asks for a code change, follow this workflow in order: search for related files, read the most relevant files, make the code changes, run build and/or test tools, automatically analyze and fix failures when possible, and only then report the result.",
    "Do not jump straight to editing before you have searched for and read the relevant files.",
    "Prefer write_project_file for direct file edits when possible; use the command tool for shell operations.",
    "After making code changes, validate them with build_project or run_tests whenever those tools fit the task.",
    "If validation fails, analyze the error output, inspect the related files again, apply the next fix, and retry until the task is resolved or the retry limit is reached.",
    "When reporting completion, clearly say what changed, what validation ran, and whether it succeeded.",
    "If the user asks for risky actions, the command tool may require approval. Use the tool anyway; the runtime will handle the confirmation step.",
    "When analyzing an error, inspect project files first before concluding.",
    "Be concise, practical, and transparent about what you found.",
    "",
    memoryContext
  ].join("\n");
}

function getAutoFixSystemPrompt(memoryContext: string): string {
  return [
    getSystemPrompt(memoryContext),
    "",
    "You are in auto-fix mode.",
    "Goal: modify code, run builds through the build_project MCP tool, analyze failures, and keep fixing until the build succeeds or the retry limit is reached.",
    "Before changing files, inspect the relevant project files with project-search tools.",
    "When you need to edit files, use the command tool to make focused changes inside the workspace.",
    "Do not say the task is complete until the external build_project result says it succeeded.",
    `The runtime will stop after ${MAX_AUTO_FIX_ATTEMPTS} build attempts, so prioritize the most likely fix each round.`,
    "Keep each round targeted to the current build failure."
  ].join("\n");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
}

function resolveWorkspaceInputPath(workspacePath: string): string {
  return path.resolve(workspacePath);
}

function normalizeToolName(tool: ConnectedTool): string {
  return `${tool.serverName}__${tool.toolName}`;
}

function logRuntimeEvent(message: string): void {
  console.log(`[agent] ${message}`);
}

function buildOllamaTools(connectedTools: ConnectedTool[]): OllamaToolDefinition[] {
  return connectedTools.map((tool) => ({
    type: "function",
    function: {
      name: normalizeToolName(tool),
      description: tool.description ?? `${tool.toolName} from ${tool.serverName}`,
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  }));
}

function findToolByNormalizedName(connectedTools: ConnectedTool[], normalizedName: string): ConnectedTool | undefined {
  return connectedTools.find((tool) => normalizeToolName(tool) === normalizedName);
}

function extractTextResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result);
  }

  const maybeContent = (result as { content?: Array<{ type?: string; text?: string }> }).content;

  if (Array.isArray(maybeContent)) {
    return maybeContent
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
  }

  return JSON.stringify(result);
}

function parseToolJson(resultText: string): ToolJsonResult | null {
  try {
    return JSON.parse(resultText) as ToolJsonResult;
  } catch {
    return null;
  }
}

function buildAnswerFromToolContent(toolName: string, content: string): string | null {
  const parsed = parseToolJson(content);
  if (!parsed) {
    return content.trim() || null;
  }

  if (!parsed.ok) {
    return parsed.message;
  }

  const data = parsed.data;

  if (toolName === "project-search__read_project_file") {
    const fileData = data as { path?: string; content?: string } | undefined;
    if (fileData?.path && typeof fileData.content === "string") {
      return [`Read [${fileData.path}]`, "", fileData.content].join("\n");
    }
  }

  if (toolName === "project-search__search_project") {
    const matches = Array.isArray((data as { path?: string; preview?: string }[] | undefined))
      ? (data as Array<{ path?: string; preview?: string }>)
      : Array.isArray((data as { data?: unknown }).data)
        ? ((data as { data: Array<{ path?: string; preview?: string }> }).data)
        : null;

    if (matches && matches.length > 0) {
      return matches
        .map((match) => `- ${match.path ?? "unknown"}: ${match.preview ?? ""}`.trim())
        .join("\n");
    }
  }

  if (toolName === "project-search__path_exists") {
    const pathData = data as { path?: string; exists?: boolean; type?: string } | undefined;
    if (pathData?.path) {
      return pathData.exists
        ? `${pathData.path} exists${pathData.type ? ` (${pathData.type})` : ""}.`
        : `${pathData.path} does not exist.`;
    }
  }

  if (toolName === "project-search__list_project_entries") {
    const entries = Array.isArray((data as unknown[] | undefined))
      ? (data as Array<{ name?: string; path?: string; type?: string }>)
      : Array.isArray((data as { data?: unknown }).data)
        ? ((data as { data: Array<{ name?: string; path?: string; type?: string }> }).data)
        : null;

    if (entries && entries.length > 0) {
      return entries
        .map((entry) => `- [${entry.type ?? "unknown"}] ${entry.path ?? entry.name ?? "unknown"}`)
        .join("\n");
    }
  }

  if (toolName === "project-search__find_files_by_name") {
    const entries = Array.isArray((data as unknown[] | undefined))
      ? (data as Array<{ path?: string; type?: string }>)
      : Array.isArray((data as { data?: unknown }).data)
        ? ((data as { data: Array<{ path?: string; type?: string }> }).data)
        : null;

    if (entries && entries.length > 0) {
      return entries
        .map((entry) => `- [${entry.type ?? "unknown"}] ${entry.path ?? "unknown"}`)
        .join("\n");
    }
  }

  if (typeof data === "string") {
    return data;
  }

  if (data && typeof data === "object") {
    return JSON.stringify(data, null, 2);
  }

  return parsed.message;
}

function buildFallbackAnswer(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool") {
      continue;
    }

    const answer = buildAnswerFromToolContent(message.tool_name, message.content);
    if (answer) {
      return answer;
    }
  }

  return null;
}

function getConnectedTool(connectedTools: ConnectedTool[], normalizedName: string): ConnectedTool {
  const tool = findToolByNormalizedName(connectedTools, normalizedName);
  if (!tool) {
    throw new Error(`Tool not found: ${normalizedName}`);
  }

  return tool;
}

function toObjectData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return data as Record<string, unknown>;
}

function extractSearchMatches(content: string): Array<{ path?: string; preview?: string }> {
  const parsed = parseToolJson(content);
  if (!parsed?.ok) {
    return [];
  }

  const dataObject = toObjectData(parsed.data);
  const rawItems = Array.isArray(parsed.data)
    ? parsed.data
    : Array.isArray(dataObject?.data)
      ? dataObject.data
      : [];

  return rawItems
    .map((item) => toObjectData(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      path: typeof item.path === "string" ? item.path : undefined,
      preview: typeof item.preview === "string" ? item.preview : undefined
    }));
}

function formatProjectMatches(content: string): string | null {
  const parsed = parseToolJson(content);
  if (!parsed) {
    return content.trim() || null;
  }

  if (!parsed.ok) {
    return parsed.message;
  }

  const rawMatches = Array.isArray(parsed.data)
    ? parsed.data
    : toObjectData(parsed.data)?.data;
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
    return "관련 파일이나 텍스트를 찾지 못했습니다.";
  }

  return rawMatches
    .map((item, index) => {
      const match = toObjectData(item);
      const matchPath = typeof match?.path === "string" ? match.path : "unknown";
      const preview = typeof match?.preview === "string" ? match.preview : "";
      return `${index + 1}. ${matchPath}${preview ? `\n   ${preview}` : ""}`;
    })
    .join("\n");
}

function explainPackageJsonScripts(fileContent: string): string {
  try {
    const parsed = JSON.parse(fileContent) as {
      scripts?: Record<string, string>;
      name?: string;
    };
    const scripts = parsed.scripts ?? {};
    const entries = Object.entries(scripts);

    if (entries.length === 0) {
      return "package.json에 scripts가 없습니다.";
    }

    const descriptions = entries.map(([name, command]) => {
      let meaning = "사용자 정의 스크립트";
      if (name === "build") {
        meaning = "TypeScript를 컴파일해서 dist를 만드는 빌드 명령";
      } else if (name === "dev") {
        meaning = "tsx로 에이전트를 바로 실행하는 개발 모드";
      } else if (name === "start") {
        meaning = "빌드된 dist/agent/index.js를 실행하는 프로덕션 시작 명령";
      } else if (name.startsWith("server:")) {
        meaning = `${name.replace("server:", "")} MCP 서버를 단독 실행하는 명령`;
      }

      return `- ${name}: ${meaning} (\`${command}\`)`;
    });

    return [
      `${parsed.name ?? "이 프로젝트"}의 package.json scripts 설명입니다.`,
      ...descriptions
    ].join("\n");
  } catch {
    return fileContent;
  }
}

function summarizeReadme(fileContent: string): string | null {
  const lines = fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ?? null;
}

function summarizePackageJson(fileContent: string): string[] {
  try {
    const parsed = JSON.parse(fileContent) as {
      name?: string;
      private?: boolean;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = Object.keys(parsed.scripts ?? {});
    const deps = Object.keys(parsed.dependencies ?? {});
    const devDeps = Object.keys(parsed.devDependencies ?? {});
    return [
      parsed.name ? `- package.json name: ${parsed.name}` : "- package.json present",
      typeof parsed.private === "boolean" ? `- package.json private: ${parsed.private}` : "",
      scripts.length > 0 ? `- package.json scripts: ${scripts.slice(0, 8).join(", ")}` : "- package.json scripts: none",
      deps.length > 0 ? `- dependencies count: ${deps.length}` : "",
      devDeps.length > 0 ? `- devDependencies count: ${devDeps.length}` : ""
    ].filter(Boolean);
  } catch {
    return ["- package.json present"];
  }
}

function summarizeTsconfig(fileContent: string): string[] {
  try {
    const parsed = JSON.parse(fileContent) as {
      compilerOptions?: Record<string, unknown>;
      include?: string[];
    };
    const compilerOptions = parsed.compilerOptions ?? {};
    return [
      "- tsconfig.json present",
      typeof compilerOptions.rootDir === "string" ? `- tsconfig rootDir: ${compilerOptions.rootDir}` : "",
      typeof compilerOptions.outDir === "string" ? `- tsconfig outDir: ${compilerOptions.outDir}` : "",
      Array.isArray(parsed.include) && parsed.include.length > 0 ? `- tsconfig include: ${parsed.include.join(", ")}` : ""
    ].filter(Boolean);
  } catch {
    return ["- tsconfig.json present"];
  }
}

function parseListedEntries(content: string): Array<{ name?: string; path?: string; type?: string }> {
  const parsed = parseToolJson(content);
  if (!parsed?.ok) {
    return [];
  }

  if (Array.isArray(parsed.data)) {
    return parsed.data as Array<{ name?: string; path?: string; type?: string }>;
  }

  const dataObject = toObjectData(parsed.data);
  return Array.isArray(dataObject?.data) ? (dataObject.data as Array<{ name?: string; path?: string; type?: string }>) : [];
}

async function readFileIfExists(
  connectedTools: ConnectedTool[],
  relativePath: string,
  maxChars = 4000
): Promise<string | null> {
  const existsTool = getConnectedTool(connectedTools, "project-search__path_exists");
  const existsResult = await executeToolCall(existsTool, { path: relativePath });
  const existsParsed = parseToolJson(existsResult);
  const existsData = toObjectData(existsParsed?.data);

  if (!existsParsed?.ok || !existsData?.exists) {
    return null;
  }

  const readTool = getConnectedTool(connectedTools, "project-search__read_project_file");
  const readResult = await executeToolCall(readTool, { path: relativePath, maxChars });
  const readParsed = parseToolJson(readResult);
  const readData = toObjectData(readParsed?.data);
  return typeof readData?.content === "string" ? readData.content : null;
}

async function tryHandleProjectStructureSummary(
  userText: string,
  connectedTools: ConnectedTool[]
): Promise<string | null> {
  const normalizedText = userText.toLowerCase();
  const asksFullAnalysis = userText.includes("전체 분석") || normalizedText.includes("full analysis");
  const asksProjectSummary =
    userText.includes("프로젝트 구조 요약") ||
    userText.includes("현재 프로젝트 구조 요약") ||
    normalizedText.includes("project structure summary");

  if (!asksProjectSummary || asksFullAnalysis) {
    return null;
  }

  const listTool = getConnectedTool(connectedTools, "project-search__list_project_entries");
  const rootListResult = await executeToolCall(listTool, { path: "." });
  const rootEntries = parseListedEntries(rootListResult);
  const directories = rootEntries.filter((entry) => entry.type === "directory").map((entry) => entry.name ?? entry.path ?? "unknown");
  const files = rootEntries.filter((entry) => entry.type === "file").map((entry) => entry.name ?? entry.path ?? "unknown");

  const summary: string[] = [
    `Current workspace: ${getWorkspaceRoot()}`,
    directories.length > 0 ? `- Root directories: ${directories.join(", ")}` : "- Root directories: none",
    files.length > 0 ? `- Root files: ${files.join(", ")}` : "- Root files: none"
  ];

  const readmeContent = await readFileIfExists(connectedTools, "README.md", 2000);
  if (readmeContent) {
    const readmeHeadline = summarizeReadme(readmeContent);
    if (readmeHeadline) {
      summary.push(`- README.md headline: ${readmeHeadline}`);
    }
  }

  const packageJsonContent = await readFileIfExists(connectedTools, "package.json", 6000);
  if (packageJsonContent) {
    summary.push(...summarizePackageJson(packageJsonContent));
  }

  const tsconfigContent = await readFileIfExists(connectedTools, "tsconfig.json", 4000);
  if (tsconfigContent) {
    summary.push(...summarizeTsconfig(tsconfigContent));
  }

  const candidateDirs = ["src", "apps", "packages", "server", "client"].filter((dirName) => directories.includes(dirName));
  for (const dirName of candidateDirs.slice(0, 3)) {
    const childListResult = await executeToolCall(listTool, { path: dirName });
    const childEntries = parseListedEntries(childListResult);
    const childNames = childEntries.map((entry) => entry.name ?? entry.path ?? "unknown").slice(0, 12);
    if (childNames.length > 0) {
      summary.push(`- ${dirName}/ children: ${childNames.join(", ")}`);
    }
  }

  summary.push("- Summary mode: shallow scan only (root files + selected metadata, no recursive src traversal)");
  return summary.join("\n");
}

function extractExplicitRelativePath(userText: string): string | null {
  const pathMatch = userText.match(/([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]+)/);
  if (!pathMatch) {
    return null;
  }

  return pathMatch[1].replaceAll("\\", "/");
}

function isDirectReadRequest(userText: string): boolean {
  const normalized = userText.toLowerCase();
  return (
    userText.includes("읽어") ||
    userText.includes("내용 보여") ||
    userText.includes("열어") ||
    normalized.includes("read ") ||
    normalized.includes("show ")
  );
}

function isDirectExistsRequest(userText: string): boolean {
  const normalized = userText.toLowerCase();
  return (
    userText.includes("있는지") ||
    userText.includes("있어") ||
    userText.includes("존재") ||
    normalized.includes("exists") ||
    normalized.includes("exist")
  );
}

async function tryHandleExactPathRequest(
  userText: string,
  connectedTools: ConnectedTool[]
): Promise<string | null> {
  const explicitPath = extractExplicitRelativePath(userText);
  if (!explicitPath) {
    return null;
  }

  if (isDirectReadRequest(userText)) {
    const tool = getConnectedTool(connectedTools, "project-search__read_project_file");
    const result = await executeToolCall(tool, { path: explicitPath, maxChars: 12000 });
    return buildAnswerFromToolContent("project-search__read_project_file", result);
  }

  if (isDirectExistsRequest(userText)) {
    const tool = getConnectedTool(connectedTools, "project-search__path_exists");
    const result = await executeToolCall(tool, { path: explicitPath });
    return buildAnswerFromToolContent("project-search__path_exists", result);
  }

  return null;
}

async function trySummarizeProjectTypeFromRequestedPaths(
  userText: string,
  connectedTools: ConnectedTool[]
): Promise<string | null> {
  const normalizedText = userText.toLowerCase();
  const requestsProjectTypeSummary =
    normalizedText.includes("project type") || userText.includes("프로젝트 타입");
  const requestsKnownPaths =
    normalizedText.includes("build.gradle") ||
    normalizedText.includes("settings.gradle") ||
    normalizedText.includes("src/main/resources");

  if (!requestsProjectTypeSummary || !requestsKnownPaths) {
    return null;
  }

  const searchTool = getConnectedTool(connectedTools, "project-search__search_project");
  const buildMatches = extractSearchMatches(await executeToolCall(searchTool, { query: "build.gradle", limit: 10 }));
  const settingsMatches = extractSearchMatches(await executeToolCall(searchTool, { query: "settings.gradle", limit: 10 }));
  const resourcesMatches = extractSearchMatches(await executeToolCall(searchTool, { query: "src/main/resources", limit: 10 }));

  const foundBuild = buildMatches.find((match) => match.path?.endsWith("build.gradle") || match.path?.endsWith("build.gradle.kts"));
  const foundSettings = settingsMatches.find((match) => match.path?.endsWith("settings.gradle") || match.path?.endsWith("settings.gradle.kts"));
  const foundResources = resourcesMatches.find((match) => match.path?.includes("src/main/resources"));

  const summary = [
    `Current workspace: ${getWorkspaceRoot()}`,
    foundBuild ? `- Found build file: ${foundBuild.path}` : "- build.gradle/build.gradle.kts not found",
    foundSettings ? `- Found settings file: ${foundSettings.path}` : "- settings.gradle/settings.gradle.kts not found",
    foundResources ? `- Found resources path: ${foundResources.path}` : "- src/main/resources not found"
  ];

  if (foundBuild || foundSettings) {
    summary.push("- Project type summary: Gradle-based Java project");
  }

  if (foundResources) {
    summary.push("- Layout summary: src/main/resources suggests a typical Java/Spring-style project structure");
  }

  if (!foundBuild && !foundSettings && !foundResources) {
    summary.push("- Project type summary: Could not infer the project type from only those requested paths");
  }

  return summary.join("\n");
}

async function tryListWorkspaceRootEntries(
  userText: string,
  connectedTools: ConnectedTool[]
): Promise<string | null> {
  const normalizedText = userText.toLowerCase();
  const asksForRootEntries =
    userText.includes("루트 파일 목록") ||
    userText.includes("루트 목록") ||
    userText.includes("루트 파일만") ||
    normalizedText.includes("root file list") ||
    normalizedText.includes("workspace root");

  const asksNotToAnalyze =
    userText.includes("분석하지 말") ||
    normalizedText.includes("don't analyze") ||
    normalizedText.includes("do not analyze");

  if (!asksForRootEntries) {
    return null;
  }

  const tool = getConnectedTool(connectedTools, "project-search__list_project_entries");
  const result = await executeToolCall(tool, { path: "." });
  const formatted = buildAnswerFromToolContent("project-search__list_project_entries", result);

  if (!formatted) {
    return null;
  }

  return asksNotToAnalyze
    ? formatted
    : [`Current workspace: ${getWorkspaceRoot()}`, formatted].join("\n");
}

async function tryHandleDirectIntent(userText: string, connectedTools: ConnectedTool[]): Promise<string | null> {
  const exactPathAnswer = await tryHandleExactPathRequest(userText, connectedTools);
  if (exactPathAnswer) {
    return exactPathAnswer;
  }

  const normalizedText = userText.toLowerCase();

  if (
    normalizedText.includes("package.json") &&
    (userText.includes("scripts") || userText.includes("스크립트")) &&
    (userText.includes("설명") || userText.includes("요약"))
  ) {
    const tool = getConnectedTool(connectedTools, "project-search__read_project_file");
    const result = await executeToolCall(tool, { path: "package.json", maxChars: 12000 });
    const parsed = parseToolJson(result);
    const payload = parsed?.ok ? toObjectData(parsed.data) : null;
    const content = typeof payload?.content === "string" ? payload.content : null;
    return content ? explainPackageJsonScripts(content) : buildAnswerFromToolContent("project-search__read_project_file", result);
  }

  if (
    (userText.includes("찾") || userText.includes("search") || userText.includes("뭐가 있는지")) &&
    (userText.includes("mcp") || userText.includes("MCP"))
  ) {
    const tool = getConnectedTool(connectedTools, "project-search__search_project");
    const result = await executeToolCall(tool, { query: "mcp", limit: 12 });
    const formatted = formatProjectMatches(result);
    if (!formatted) {
      return null;
    }

    return ["src 기준 mcp 관련 검색 결과입니다.", formatted].join("\n");
  }

  if (userText.includes("오늘 할 일") || userText.includes("today") || userText.includes("할 일 보여")) {
    const tool = getConnectedTool(connectedTools, "todo__list_todos");
    const result = await executeToolCall(tool, { filter: "today" });
    return buildAnswerFromToolContent("todo__list_todos", result);
  }

  return null;
}

async function executeToolCall(tool: ConnectedTool, args: Record<string, unknown>): Promise<string> {
  const toolLabel = normalizeToolName(tool);
  const startedAt = Date.now();
  logRuntimeEvent(`tool:start ${toolLabel} args=${JSON.stringify(args)}`);
  const rawResult = await tool.call(args);
  const content = extractTextResult(rawResult);
  const parsed = parseToolJson(content);

  if (parsed && !parsed.ok && parsed.approval?.approvalRequired) {
    const approved = await requestApproval(parsed.approval.reason);
    if (!approved) {
      return JSON.stringify({
        ok: false,
        message: "User declined the requested risky action."
      });
    }

    const rerunResult = await tool.call({
      ...args,
      approved: true
    });

    const rerunContent = extractTextResult(rerunResult);
    logRuntimeEvent(`tool:end ${toolLabel} duration_ms=${Date.now() - startedAt} approved=true`);
    return rerunContent;
  }

  logRuntimeEvent(`tool:end ${toolLabel} duration_ms=${Date.now() - startedAt}`);
  return content;
}

async function callOllama(baseUrl: string, model: string, messages: ChatMessage[], tools: OllamaToolDefinition[]): Promise<OllamaChatResponse> {
  const startedAt = Date.now();
  logRuntimeEvent(`ollama:start messages=${messages.length} tools=${tools.length}`);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: false,
      think: false,
      options: {
        num_ctx: 2048,
        num_predict: MAX_OLLAMA_RESPONSE_TOKENS,
        temperature: 0.1
      },
      keep_alive: "5m"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  logRuntimeEvent(`ollama:end duration_ms=${Date.now() - startedAt}`);
  return payload;
}

function buildFailureContext(content: string): string {
  const parsed = parseToolJson(content);
  if (!parsed) {
    return content;
  }

  const data = toObjectData(parsed.data);
  const stdout = typeof data?.stdout === "string" ? data.stdout : "";
  const stderr = typeof data?.stderr === "string" ? data.stderr : "";
  const command = typeof data?.command === "string" ? data.command : "";
  const projectRoot = typeof data?.projectRoot === "string" ? data.projectRoot : "";
  const buildSystem = typeof data?.buildSystem === "string" ? data.buildSystem : "";

  return [
    `ok: ${parsed.ok}`,
    `message: ${parsed.message}`,
    buildSystem ? `buildSystem: ${buildSystem}` : "",
    projectRoot ? `projectRoot: ${projectRoot}` : "",
    command ? `command: ${command}` : "",
    stdout ? `stdout:\n${stdout}` : "",
    stderr ? `stderr:\n${stderr}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function didToolCallSucceed(content: string): boolean {
  const parsed = parseToolJson(content);
  return Boolean(parsed?.ok);
}

function extractAutoFixInstruction(userText: string): string | null {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("/autofix")) {
    const instruction = trimmed.slice("/autofix".length).trim();
    return instruction || "Fix the current project until build_project succeeds.";
  }

  if (
    lower.includes("autofix") ||
    lower.includes("auto fix") ||
    (trimmed.includes("자동 수정") && (trimmed.includes("빌드") || trimmed.includes("build")))
  ) {
    return trimmed;
  }

  return null;
}

async function runToolConversation(
  baseUrl: string,
  model: string,
  connectedTools: ConnectedTool[],
  messages: ChatMessage[]
): Promise<ToolConversationResult> {
  const tools = buildOllamaTools(connectedTools);

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
    const response = await callOllama(baseUrl, model, messages, tools);
    const message = response.message;

    if (!message) {
      throw new Error("Ollama returned no message.");
    }

    const toolCalls = (message.tool_calls ?? []).filter(
      (toolCall) => toolCall.type === "function" && toolCall.function?.name
    ) as Array<{
      type: "function";
      function: {
        name: string;
        arguments?: Record<string, unknown>;
      };
    }>;

    if (toolCalls.length === 0) {
      const finalAnswer = message.content?.trim() || buildFallbackAnswer(messages);
      if (!finalAnswer && iteration < MAX_TOOL_LOOP_ITERATIONS - 1) {
        messages.push({
          role: "user",
          content: "You returned an empty answer. Use the available tools if needed, then provide a concrete response."
        });
        continue;
      }

      return {
        messages,
        finalAnswer: finalAnswer || "No answer returned."
      };
    }

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls.map((toolCall) => ({
        type: "function",
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ?? {}
        }
      }))
    });

    for (const toolCall of toolCalls) {
      const tool = findToolByNormalizedName(connectedTools, toolCall.function.name);

      if (!tool) {
        messages.push({
          role: "tool",
          tool_name: toolCall.function.name,
          content: JSON.stringify({
            ok: false,
            message: `Tool not found: ${toolCall.function.name}`
          })
        });
        continue;
      }

      const toolResult = await executeToolCall(tool, toolCall.function.arguments ?? {});
      messages.push({
        role: "tool",
        tool_name: toolCall.function.name,
        content: toolResult
      });
    }
  }

  throw new Error("Tool loop exceeded the maximum number of iterations.");
}

async function runAutoFixLoop(
  baseUrl: string,
  model: string,
  connectedTools: ConnectedTool[],
  userText: string
): Promise<string> {
  const autoFixInstruction = extractAutoFixInstruction(userText);
  if (!autoFixInstruction) {
    throw new Error("Auto-fix instruction was not provided.");
  }

  const buildTool = getConnectedTool(connectedTools, "build-test__build_project");
  const memoryContext = await buildMemoryContext();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: getAutoFixSystemPrompt(memoryContext)
    },
    {
      role: "user",
      content: [
        "Start an auto-fix loop for this request.",
        autoFixInstruction,
        "Inspect the codebase, make the first set of changes, and stop when you are ready for a build."
      ].join("\n\n")
    }
  ];

  let latestAssistantAnswer = "";

  for (let attempt = 1; attempt <= MAX_AUTO_FIX_ATTEMPTS; attempt += 1) {
    const conversation = await runToolConversation(baseUrl, model, connectedTools, messages);
    latestAssistantAnswer = conversation.finalAnswer;

    const buildResult = await executeToolCall(buildTool, {});
    const buildSummary = buildFailureContext(buildResult);

    messages.push({
      role: "user",
      content: [
        `build_project attempt ${attempt}/${MAX_AUTO_FIX_ATTEMPTS} result:`,
        buildSummary
      ].join("\n\n")
    });

    if (didToolCallSucceed(buildResult)) {
      messages.push({
        role: "user",
        content: `The build succeeded on attempt ${attempt}. Summarize the fixes you made and mention that the auto-fix loop has stopped.`
      });
      const finalConversation = await runToolConversation(baseUrl, model, connectedTools, messages);
      return [
        `Auto-fix succeeded after ${attempt} build attempt(s).`,
        finalConversation.finalAnswer
      ].join("\n\n");
    }

    if (attempt === MAX_AUTO_FIX_ATTEMPTS) {
      messages.push({
        role: "user",
        content: `The build is still failing after ${MAX_AUTO_FIX_ATTEMPTS} attempts. Summarize what was changed, explain the remaining blocker from the latest build result, and suggest the next fix to try.`
      });
      const finalConversation = await runToolConversation(baseUrl, model, connectedTools, messages);
      return [
        `Auto-fix stopped after ${MAX_AUTO_FIX_ATTEMPTS} failed build attempt(s).`,
        finalConversation.finalAnswer
      ].join("\n\n");
    }

    messages.push({
      role: "user",
      content: [
        `The build failed on attempt ${attempt}.`,
        "Analyze the failure output above, inspect the relevant files, apply the next fix, and stop when you are ready for another build."
      ].join("\n\n")
    });
  }

  return latestAssistantAnswer || "Auto-fix loop finished without a final answer.";
}

async function handleUserTurn(
  baseUrl: string,
  model: string,
  connectedTools: ConnectedTool[],
  userText: string
): Promise<string> {
  const projectStructureSummary = await tryHandleProjectStructureSummary(userText, connectedTools);
  if (projectStructureSummary) {
    await appendConversationSummary(userText, projectStructureSummary.slice(0, 300));
    return projectStructureSummary;
  }

  const rootEntries = await tryListWorkspaceRootEntries(userText, connectedTools);
  if (rootEntries) {
    await appendConversationSummary(userText, rootEntries.slice(0, 300));
    return rootEntries;
  }

  const projectTypeSummary = await trySummarizeProjectTypeFromRequestedPaths(userText, connectedTools);
  if (projectTypeSummary) {
    await appendConversationSummary(userText, projectTypeSummary.slice(0, 300));
    return projectTypeSummary;
  }

  const autoFixInstruction = extractAutoFixInstruction(userText);
  if (autoFixInstruction) {
    const autoFixAnswer = await runAutoFixLoop(baseUrl, model, connectedTools, userText);
    await appendConversationSummary(userText, autoFixAnswer.slice(0, 300));
    return autoFixAnswer;
  }

  const directAnswer = await tryHandleDirectIntent(userText, connectedTools);
  if (directAnswer) {
    await appendConversationSummary(userText, directAnswer.slice(0, 300));
    return directAnswer;
  }

  const memoryContext = await buildMemoryContext();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: getSystemPrompt(memoryContext)
    },
    {
      role: "user",
      content: userText
    }
  ];

  const conversation = await runToolConversation(baseUrl, model, connectedTools, messages);
  await appendConversationSummary(userText, conversation.finalAnswer.slice(0, 300));
  return conversation.finalAnswer;
}

async function handleWorkspaceCommand(line: string): Promise<string | null> {
  const trimmed = line.trim();

  if (trimmed === "workspace show") {
    return `Current workspace: ${getWorkspaceRoot()}`;
  }

  if (!trimmed.startsWith("workspace set ")) {
    return null;
  }

  const rawPath = trimmed.slice("workspace set ".length).trim();
  if (!rawPath) {
    return "Usage: workspace set <path>";
  }

  const nextWorkspaceRoot = resolveWorkspaceInputPath(rawPath);
  if (!(await pathExists(nextWorkspaceRoot))) {
    return `Workspace path does not exist: ${nextWorkspaceRoot}`;
  }

  if (!(await isDirectory(nextWorkspaceRoot))) {
    return `Workspace path is not a directory: ${nextWorkspaceRoot}`;
  }

  setWorkspaceRoot(nextWorkspaceRoot);
  return `Workspace updated: ${getWorkspaceRoot()}`;
}

async function verifyOllamaAvailability(baseUrl: string, model: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/tags`);

  if (!response.ok) {
    throw new Error(`Could not reach Ollama at ${baseUrl}. Status: ${response.status}`);
  }

  const payload = (await response.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };

  const modelNames = new Set(
    (payload.models ?? []).flatMap((item) => [item.name, item.model].filter((value): value is string => Boolean(value)))
  );

  if (!modelNames.has(model)) {
    throw new Error(
      `Ollama is running but model "${model}" is not installed. Run: ollama pull ${model}`
    );
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

  await verifyOllamaAvailability(baseUrl, model);

  const mcpClient = new MultiMcpClient([
    { name: "memo", command: "node", args: [getServerScript("memo")] },
    { name: "todo", command: "node", args: [getServerScript("todo")] },
    { name: "project-search", command: "node", args: [getServerScript("project-search")] },
    { name: "build-test", command: "node", args: [getServerScript("build-test")] },
    { name: "command", command: "node", args: [getServerScript("command")] },
    { name: "git", command: "node", args: [getServerScript("git")] }
  ]);

  const connectedTools = await mcpClient.connect();
  const rl = readline.createInterface({ input, output });

  console.log("Personal MCP Assistant");
  console.log(`Ollama model: ${model}`);
  console.log(`Workspace root: ${getWorkspaceRoot()}`);
  console.log("Type /help for commands. Type /exit to quit.");

  try {
    while (true) {
      const line = (await rl.question("\nYou> ")).trim();
      if (!line) {
        continue;
      }

      if (line === "/exit") {
        break;
      }

      if (line === "/help") {
        console.log("Commands: /help, /tools, /autofix <instruction>, workspace show, workspace set <path>, /exit");
        continue;
      }

      const workspaceCommandResult = await handleWorkspaceCommand(line);
      if (workspaceCommandResult) {
        console.log(`\nAssistant> ${workspaceCommandResult}`);
        continue;
      }

      if (line === "/tools") {
        for (const tool of connectedTools) {
          console.log(`- ${normalizeToolName(tool)}: ${tool.description ?? "No description"}`);
        }
        continue;
      }

      const answer = await handleUserTurn(baseUrl, model, connectedTools, line);
      console.log(`\nAssistant> ${answer}`);
    }
  } finally {
    rl.close();
    await mcpClient.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
