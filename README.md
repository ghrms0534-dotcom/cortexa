# Personal MCP Agent Assistant

로컬 Ollama 모델을 사용하고, 여러 MCP 서버에서 도구를 선택하며, CLI 에이전트를 통해 워크스페이스 작업을 안전하게 수행하는 Windows 친화적인 개인용 어시스턴트 앱입니다.

## 기능

- TypeScript + Node.js 기반 CLI 채팅 에이전트
- 로컬 Ollama API를 직접 사용하는 에이전트 루프
- 메모, 할 일, 프로젝트 검색, 명령 실행을 위한 로컬 MCP 서버
- 대화 요약, 메모, 할 일을 저장하는 JSON 기반 메모리
- 삭제 명령이나 `git push` 같은 위험 작업에 대한 승인 게이트
- Claude Desktop, Cursor, OpenWebUI용 MCP 서버 연결 예시 제공
- 기본 로컬 모델: `qwen3:8b`

## 프로젝트 구조

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

## 요구 사항

- Windows 10 22H2 이상
- Node.js 20+
- PowerShell
- Ollama for Windows

## 1. Windows에 Ollama 설치

공식 Ollama 문서에 따르면 Windows를 기본 지원하며, API는 `http://localhost:11434`에서 실행되고 설치 후 PowerShell에서 `ollama` 명령을 사용할 수 있습니다.

PowerShell로 설치:

```powershell
irm https://ollama.com/install.ps1 | iex
```

또는 아래에서 Windows 설치 프로그램을 다운로드할 수 있습니다.

- https://ollama.com/download/windows

설치 확인:

```powershell
ollama --version
```

## 2. 기본 모델 다운로드

이 프로젝트의 기본 모델은 `qwen3:8b`입니다.

```powershell
ollama pull qwen3:8b
```

간단한 로컬 동작 확인:

```powershell
ollama run qwen3:8b
```

PC 메모리가 16GB이고 모델이 너무 느리다면 더 작은 모델을 사용해 보세요.

```powershell
ollama pull qwen3:4b
ollama pull gemma3:4b
```

## 3. Node.js 의존성 설치

```powershell
cd C:\Workspace\Agent
npm install
```

## 4. 환경 변수 설정

필요하다면:

```powershell
Copy-Item .env.example .env
notepad .env
```

기본 `.env`:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
AGENT_WORKSPACE_ROOT=.
```

각 변수의 의미:

- `OLLAMA_BASE_URL`: Ollama API 기본 URL
- `OLLAMA_MODEL`: 에이전트가 사용할 로컬 모델 이름
- `AGENT_WORKSPACE_ROOT`: 검색 및 명령 도구가 사용할 워크스페이스 루트

만약 16GB RAM 환경에서 `qwen3:8b`가 너무 느리다면 모델 이름만 바꾸면 됩니다.

```env
OLLAMA_MODEL=qwen3:4b
```

또는:

```env
OLLAMA_MODEL=gemma3:4b
```

## 5. 프로젝트 빌드

```powershell
npm run build
```

## 6. MCP 서버 실행

빌드 후 에이전트가 모든 로컬 MCP 서버를 자동으로 실행하고 연결하므로, 보통은 수동으로 서버를 띄울 필요가 없습니다.

수동 실행 명령:

```powershell
npm run server:memo
npm run server:todo
npm run server:project-search
npm run server:command
```

빌드 결과물로 직접 실행:

```powershell
node .\dist\mcp-servers\memo.js
node .\dist\mcp-servers\todo.js
node .\dist\mcp-servers\project-search.js
node .\dist\mcp-servers\command.js
```

이 서버들은 stdio 기반 MCP 서버이므로, 직접 실행하면 보통 클라이언트 연결을 기다리는 상태로 유지됩니다.

## 7. 에이전트 실행

개발 모드:

```powershell
npm run dev
```

프로덕션 모드:

```powershell
npm run build
npm start
```

CLI가 시작되면 먼저 아래 항목을 확인합니다.

- `OLLAMA_BASE_URL`에서 Ollama에 접속 가능한지
- 설정한 모델이 로컬에 존재하는지

모델이 없다면 아래 명령을 실행하라는 안내가 표시됩니다.

```powershell
ollama pull <model-name>
```

## 8. 설정 테스트

### A. Ollama API 확인

API로 로컬 모델 목록 확인:

```powershell
curl http://localhost:11434/api/tags
```

또는 PowerShell에서:

```powershell
(Invoke-WebRequest http://localhost:11434/api/tags).Content
```

### B. 선택한 모델 확인

```powershell
ollama list
```

`qwen3:8b` 또는 `.env`에 설정한 모델이 보여야 합니다.

### C. TypeScript 빌드 확인

```powershell
npm run build
```

### D. 에이전트 CLI 실행

```powershell
npm run dev
```

그다음 아래와 같은 프롬프트로 테스트해 볼 수 있습니다.

- `프로젝트에서 Controller 찾아줘`
- `메모 저장해줘: 다음 주 중요 회의 준비`
- `오늘 할 일 보여줘`
- `에러 원인 찾아줘 NullReferenceException`
- `package.json에서 test 관련 스크립트 찾아줘`

### E. 도구 연결 확인

CLI 내부에서:

```text
/tools
```

### F. 위험 작업 승인 확인

CLI 내부에서:

```text
git push 해줘
```

명령이 바로 실행되면 안 됩니다. 먼저 CLI가 승인을 요청해야 합니다.

## 동작 방식

1. CLI가 사용자 메시지를 받습니다.
2. 에이전트가 대화 내용, 메모리 컨텍스트, 도구 스키마를 Ollama로 보냅니다.
3. 모델이 하나 이상의 MCP 도구를 선택합니다.
4. 에이전트가 stdio를 통해 선택된 MCP 도구를 호출합니다.
5. 도구가 위험 작업을 보고하면, 에이전트는 다시 실행하기 전에 승인을 요청합니다.
6. 도구 실행 결과가 최종 응답 생성을 위해 다시 모델로 전달됩니다.
7. 짧은 대화 요약이 `memory/conversation-summaries.json`에 저장됩니다.

## MCP 서버

### 메모 서버

- `save_memo`
- `list_memos`
- `search_memos`

### 할 일 서버

- `add_todo`
- `list_todos`
- `complete_todo`

### 프로젝트 검색 서버

- `search_project`
- `read_project_file`

### 명령 서버

- `run_command`

위험한 명령은 사용자가 승인한 뒤 `approved: true`가 전달되기 전까지 승인 요청을 반환합니다.

## MCP 클라이언트 설정

`npm run build` 이후 생성된 JS 파일을 사용하세요.

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

## 메모리 파일

- `memory/conversation-summaries.json`: 짧은 대화 요약
- `memory/memos.json`: 저장된 메모
- `memory/todos.json`: 할 일 항목

## 안전성 모델

명령 서버는 아래 패턴을 위험한 작업으로 분류합니다.

- `del`, `erase`, `rmdir`, `Remove-Item`
- `git push`
- `scp`, `curl`, `Invoke-WebRequest`
- `mail`, `send-mailmessage`

위험 요소가 감지되면 CLI는 실행 전에 승인을 요청합니다.

## 참고

- OpenAI 의존성과 API 키 요구 사항은 제거되었습니다.
- 에이전트 루프는 여전히 직접 구현되어 있으며, 이제 Ollama Chat API를 호출합니다.
- Windows에서 네이티브 SQLite 설치 부담을 줄이기 위해 JSON 저장소를 선택했습니다.
- `AGENT_WORKSPACE_ROOT`는 프로젝트 검색 및 명령 서버가 접근할 수 있는 범위를 제어합니다.
