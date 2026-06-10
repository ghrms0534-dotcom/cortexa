import "dotenv/config";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { appendConversationSummary } from "../shared/memory-store.js";
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

function getServerScript(name: string): string {
  return path.resolve(process.cwd(), "dist", "mcp-servers", `${name}.js`);
}

function getSystemPrompt(memoryContext: string): string {
  return [
    "You are a personal MCP assistant running on Windows with a local Ollama model.",
    "Use tools when they would make the answer more reliable or when the user asks you to save, search, inspect, or execute something.",
    "Prefer project-search tools for codebase inspection, memo tools for memory, todo tools for tasks, and command tools for local shell work.",
    "If the user asks for risky actions, the command tool may require approval. Use the tool anyway; the runtime will handle the confirmation step.",
    "When analyzing an error, inspect project files first before concluding.",
    "Be concise, practical, and transparent about what you found.",
    "",
    memoryContext
  ].join("\n");
}

function normalizeToolName(tool: ConnectedTool): string {
  return `${tool.serverName}__${tool.toolName}`;
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

async function tryHandleDirectIntent(userText: string, connectedTools: ConnectedTool[]): Promise<string | null> {
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

    return extractTextResult(rerunResult);
  }

  return content;
}

async function callOllama(baseUrl: string, model: string, messages: ChatMessage[], tools: OllamaToolDefinition[]): Promise<OllamaChatResponse> {
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
        num_ctx: 4096
      },
      keep_alive: "5m"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as OllamaChatResponse;
}

async function handleUserTurn(
  baseUrl: string,
  model: string,
  connectedTools: ConnectedTool[],
  userText: string
): Promise<string> {
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

  const tools = buildOllamaTools(connectedTools);

  for (let iteration = 0; iteration < 8; iteration += 1) {
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
      const finalAnswer = message.content?.trim() || buildFallbackAnswer(messages) || "No answer returned.";
      await appendConversationSummary(userText, finalAnswer.slice(0, 300));
      return finalAnswer;
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
  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";

  await verifyOllamaAvailability(baseUrl, model);

  const mcpClient = new MultiMcpClient([
    { name: "memo", command: "node", args: [getServerScript("memo")] },
    { name: "todo", command: "node", args: [getServerScript("todo")] },
    { name: "project-search", command: "node", args: [getServerScript("project-search")] },
    { name: "command", command: "node", args: [getServerScript("command")] },
    { name: "git", command: "node", args: [getServerScript("git")] }
  ]);

  const connectedTools = await mcpClient.connect();
  const rl = readline.createInterface({ input, output });

  console.log("Personal MCP Assistant");
  console.log(`Ollama model: ${model}`);
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
        console.log("Commands: /help, /tools, /exit");
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
