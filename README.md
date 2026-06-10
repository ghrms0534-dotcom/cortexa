# Personal MCP Agent Assistant

Windows-friendly personal assistant app that uses a local Ollama model, selects tools from multiple MCP servers, and safely performs workspace tasks through a CLI agent.

## Features

- TypeScript + Node.js CLI chat agent
- Direct agent loop using the local Ollama API
- Local MCP servers for memos, todos, project search, and commands
- JSON-based memory for conversation summaries, memos, and todos
- Approval gate for risky operations like delete commands or `git push`
- MCP server connection examples for Claude Desktop, Cursor, and OpenWebUI
- Default local model: `qwen3:8b`

## Project Structure

```text
.
|-- memory/
|   |-- conversation-summaries.json
|   |-- memos.json
|   `-- todos.json
|-- src/
|   |-- agent/
|   |   |-- approval.ts
|   |   |-- index.ts
|   |   |-- memory-context.ts
|   |   `-- mcp-client.ts
|   |-- mcp-servers/
|   |   |-- command.ts
|   |   |-- memo.ts
|   |   |-- project-search.ts
|   |   `-- todo.ts
|   `-- shared/
|       |-- json-store.ts
|       |-- memory-store.ts
|       |-- project-search.ts
|       |-- risk.ts
|       `-- types.ts
|-- .env
|-- .env.example
|-- package.json
|-- README.md
`-- tsconfig.json
```

## Requirements

- Windows 10 22H2 or newer
- Node.js 20+
- PowerShell
- Ollama for Windows

## 1. Install Ollama on Windows

Official Ollama docs say Windows support is native, the API runs on `http://localhost:11434`, and the `ollama` command becomes available in PowerShell after install.

Install with PowerShell:

```powershell
irm https://ollama.com/install.ps1 | iex
```

Or download the Windows installer from:

- https://ollama.com/download/windows

Verify installation:

```powershell
ollama --version
```

## 2. Download the default model

This project defaults to `qwen3:8b`.

```powershell
ollama pull qwen3:8b
```

Quick local check:

```powershell
ollama run qwen3:8b
```

If your machine has 16GB RAM and the model feels too slow, try a smaller model:

```powershell
ollama pull qwen3:4b
ollama pull gemma3:4b
```

## 3. Install Node.js dependencies

```powershell
cd C:\Workspace\Agent
npm install
```

## 4. Configure environment variables

If needed:

```powershell
Copy-Item .env.example .env
notepad .env
```

Default `.env`:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
AGENT_WORKSPACE_ROOT=.
```

Variable meanings:

- `OLLAMA_BASE_URL`: Ollama API base URL
- `OLLAMA_MODEL`: local model name used by the agent
- `AGENT_WORKSPACE_ROOT`: workspace root for search and command tools

If `qwen3:8b` is too slow on 16GB RAM, change only the model name:

```env
OLLAMA_MODEL=qwen3:4b
```

or:

```env
OLLAMA_MODEL=gemma3:4b
```

## 5. Build the project

```powershell
npm run build
```

## 6. MCP server execution

The agent automatically spawns and connects to all local MCP servers after build. You usually do not need to launch them manually.

Manual server commands:

```powershell
npm run server:memo
npm run server:todo
npm run server:project-search
npm run server:command
```

Built-file form:

```powershell
node .\dist\mcp-servers\memo.js
node .\dist\mcp-servers\todo.js
node .\dist\mcp-servers\project-search.js
node .\dist\mcp-servers\command.js
```

These are stdio MCP servers, so when run directly they usually just wait for a client connection.

## 7. Run the agent

Development mode:

```powershell
npm run dev
```

Production mode:

```powershell
npm run build
npm start
```

When the CLI starts, it first checks:

- Ollama is reachable at `OLLAMA_BASE_URL`
- the configured model exists locally

If the model is missing, it will tell you to run:

```powershell
ollama pull <model-name>
```

## 8. Test the setup

### A. Check the Ollama API

List local models with the API:

```powershell
curl http://localhost:11434/api/tags
```

Or with PowerShell:

```powershell
(Invoke-WebRequest http://localhost:11434/api/tags).Content
```

### B. Check the selected model

```powershell
ollama list
```

You should see `qwen3:8b` or the model configured in `.env`.

### C. Check TypeScript build

```powershell
npm run build
```

### D. Run the agent CLI

```powershell
npm run dev
```

Then test prompts like:

- `내 프로젝트에서 Controller 찾아줘`
- `이 내용 메모해줘: 다음 주 화요일 회의 준비`
- `오늘 할 일 보여줘`
- `이 에러 원인 찾아줘: NullReferenceException`
- `package.json에서 test 관련 스크립트 찾아줘`

### E. Confirm tools are attached

Inside the CLI:

```text
/tools
```

### F. Confirm risky action approval

Inside the CLI:

```text
git push 해줘
```

The command should not run immediately. The CLI should ask for approval first.

## How It Works

1. The CLI receives a user message.
2. The agent sends the conversation, memory context, and tool schemas to Ollama.
3. The model chooses one or more MCP tools.
4. The agent calls the selected MCP tool over stdio.
5. If a tool reports a risky action, the agent asks for approval before re-running it.
6. Tool results are returned to the model for the final answer.
7. A short conversation summary is stored in `memory/conversation-summaries.json`.

## MCP Servers

### Memo server

- `save_memo`
- `list_memos`
- `search_memos`

### Todo server

- `add_todo`
- `list_todos`
- `complete_todo`

### Project search server

- `search_project`
- `read_project_file`

### Command server

- `run_command`

Risky commands return an approval request unless `approved: true` is sent after the user confirms.

## MCP Client Configuration

Use the built JS files after `npm run build`.

### Claude Desktop

```json
{
  "mcpServers": {
    "memo": {
      "command": "node",
      "args": ["C:/Workspace/Agent/dist/mcp-servers/memo.js"]
    },
    "todo": {
      "command": "node",
      "args": ["C:/Workspace/Agent/dist/mcp-servers/todo.js"]
    },
    "project-search": {
      "command": "node",
      "args": ["C:/Workspace/Agent/dist/mcp-servers/project-search.js"]
    },
    "command": {
      "command": "node",
      "args": ["C:/Workspace/Agent/dist/mcp-servers/command.js"]
    }
  }
}
```

### Cursor

```json
{
  "name": "project-search",
  "command": "node",
  "args": ["C:/Workspace/Agent/dist/mcp-servers/project-search.js"]
}
```

### OpenWebUI

```json
{
  "name": "todo",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Workspace/Agent/dist/mcp-servers/todo.js"],
  "cwd": "C:/Workspace/Agent"
}
```

## Memory Files

- `memory/conversation-summaries.json`: short turn summaries
- `memory/memos.json`: saved memos
- `memory/todos.json`: todo items

## Safety Model

The command server marks these patterns as risky:

- `del`, `erase`, `rmdir`, `Remove-Item`
- `git push`
- `scp`, `curl`, `Invoke-WebRequest`
- `mail`, `send-mailmessage`

When risk is detected, the CLI asks for approval before execution.

## Notes

- The OpenAI dependency and API key requirement were removed.
- The agent loop is still implemented directly and now calls the Ollama Chat API.
- JSON storage was chosen to avoid native SQLite installation friction on Windows.
- `AGENT_WORKSPACE_ROOT` controls what the project-search and command servers can access.
