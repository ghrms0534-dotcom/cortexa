# Personal MCP Agent Assistant

로컬 Ollama 모델과 여러 MCP 서버를 조합해, 현재 선택된 Workspace를 대상으로 파일 조회, 코드 수정, 빌드/테스트, Git 확인까지 수행하는 Windows 친화적 CLI 에이전트입니다.

## 프로젝트 개요

이 프로젝트는 다음 목적을 위해 만들어졌습니다.

- 로컬 Ollama 모델 기반의 개인용 코딩 에이전트 제공
- 여러 MCP Tool을 통해 프로젝트 파일, 명령 실행, Git, 메모, 할 일 기능 통합
- Workspace를 바꿔가며 서로 다른 프로젝트를 재사용 가능하게 지원
- 조회성 요청은 빠르게, 코드 수정 요청은 build/test 검증까지 이어지는 흐름 제공

핵심 특징:

- TypeScript + Node.js 기반 CLI 에이전트
- stdio 기반 로컬 MCP 서버 구성
- Workspace 전환 기능 지원
- 프로젝트 파일 조회/쓰기 Tool 제공
- Gradle / Maven / package.json 기반 프로젝트 build/test 지원
- Auto Fix Loop 지원
- 위험 명령 승인 게이트 지원

기본 Ollama 모델:

- `qwen2.5:3b`

대체 후보:

- `qwen3:4b`

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
|   |   |-- build-test.ts
|   |   |-- command.ts
|   |   |-- git.ts
|   |   |-- memo.ts
|   |   |-- project-search.ts
|   |   `-- todo.ts
|   `-- shared/
|       |-- build-system.ts
|       |-- json-store.ts
|       |-- memory-store.ts
|       |-- project-search.ts
|       |-- risk.ts
|       |-- types.ts
|       `-- workspace.ts
|-- .env
|-- .env.example
|-- package.json
|-- README.md
`-- tsconfig.json
```

## 개발 환경

- Windows 10 22H2 이상
- Node.js 20+
- PowerShell
- Ollama for Windows

권장 환경:

- CPU 환경: `qwen2.5:3b`
- 메모리 여유가 조금 더 있으면: `qwen3:4b`

## 설치 방법

### 1. Ollama 설치

PowerShell:

```powershell
irm https://ollama.com/install.ps1 | iex
```

또는 Windows 설치 파일:

- https://ollama.com/download/windows

설치 확인:

```powershell
ollama --version
```

### 2. 기본 모델 다운로드

기본 모델:

```powershell
ollama pull qwen2.5:3b
```

대체 모델:

```powershell
ollama pull qwen3:4b
```

간단 실행 확인:

```powershell
ollama run qwen2.5:3b
```

### 3. 의존성 설치

```powershell
cd C:\Workspace\Agent
npm install
```

### 4. 환경 변수 설정

```powershell
Copy-Item .env.example .env
notepad .env
```

기본 `.env.example`:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
AGENT_WORKSPACE_ROOT=.
```

변수 설명:

- `OLLAMA_BASE_URL`: Ollama API 주소
- `OLLAMA_MODEL`: 에이전트가 사용할 기본 모델
- `AGENT_WORKSPACE_ROOT`: 첫 실행 시 기본 Workspace 루트

## 실행 방법

### 개발 모드

```powershell
npm run dev
```

### 프로덕션 모드

```powershell
npm run build
npm start
```

CLI 시작 시 확인하는 항목:

- Ollama 서버 접속 가능 여부
- 설정 모델 설치 여부

모델이 없으면 다음처럼 설치하면 됩니다.

```powershell
ollama pull <model-name>
```

## Workspace 기능 사용법

이 에이전트는 현재 Workspace를 기준으로 동작합니다. MCP 프로젝트 위치와 별개로, 다른 프로젝트를 대상으로 작업할 수 있습니다.

사용 가능한 명령:

```text
workspace show
workspace set <path>
```

예시:

```text
workspace set C:\Workspace\clinicalresearch-api
workspace show
```

현재 Workspace를 기준으로 동작하는 Tool 범위:

- 프로젝트 파일 조회
- 프로젝트 파일 쓰기
- 파일 존재 확인
- 디렉터리 목록 조회
- 이름 기반 파일 탐색
- 명령 실행
- Git 상태/로그/차이 확인
- 빌드/테스트 실행

## 사용 가능한 MCP Tools

### Memo 서버

- `save_memo`
- `list_memos`
- `search_memos`

### Todo 서버

- `add_todo`
- `list_todos`
- `complete_todo`

### Project Search 서버

- `search_project`
- `path_exists`
- `list_project_entries`
- `find_files_by_name`
- `read_project_file`
- `write_project_file`

### Command 서버

- `run_command`

위험 명령은 승인 요청이 먼저 발생합니다.

### Build/Test 서버

- `build_project`
- `run_tests`

지원 대상:

- Gradle 프로젝트
- Maven 프로젝트
- `package.json` 기반 Node.js / React / Vue 프로젝트

### Git 서버

- `git_status`
- `git_diff`
- `git_log`

## 현재 에이전트 동작 방식

### 조회성 요청

파일명이 명확한 경우:

- `README.md 읽어줘`
- `build.gradle 있어?`
- `package.json 읽어줘`

이런 요청은 전체 검색 없이 바로 Tool을 호출하도록 최적화되어 있습니다.

### 프로젝트 구조 요약

`현재 프로젝트 구조 요약` 요청은 기본적으로 다음만 확인합니다.

- 루트 파일/폴더 목록
- `README.md`
- `package.json`
- `tsconfig.json`

기본 정책:

- `src` 전체 재귀 탐색 금지
- 필요한 경우에만 상위 폴더 1단계 수준 추가 조회
- 제외 디렉터리:
  - `.git`
  - `node_modules`
  - `dist`
  - `build`
  - `.gradle`
  - `target`

`전체 분석`이라고 명시한 경우에만 더 깊은 분석 흐름으로 넘어갑니다.

### 코드 수정 요청

코드 수정 요청은 다음 순서를 따르도록 설계되어 있습니다.

1. 관련 파일 검색
2. 파일 읽기
3. 수정
4. build/test 실행
5. 실패 시 자동 수정 재시도
6. 성공 후 결과 보고

### Auto Fix Loop

명령:

```text
/autofix <instruction>
```

예시:

```text
/autofix build 깨지는 부분 고쳐줘
```

동작:

1. 관련 파일 확인
2. 코드 수정
3. `build_project` 실행
4. 실패 분석
5. 재수정
6. 최대 5회까지 반복

## 예제 명령어

### Workspace

```text
workspace show
workspace set C:\Workspace\clinicalresearch-api
```

### 파일 조회

```text
README.md 읽어줘
build.gradle 있어?
src/main/resources 아래 파일 목록 보여줘
application.yml 이름으로 찾아줘
```

### 프로젝트 요약

```text
현재 프로젝트 구조 요약해줘
build.gradle, settings.gradle, src/main/resources 기준으로 프로젝트 타입 요약해줘
```

### 빌드/테스트

```text
현재 워크스페이스에서 build_project 실행해줘
현재 워크스페이스에서 run_tests 실행해줘
```

### 코드 작업

```text
README.md에 한 줄 추가해줘
package.json scripts 설명해줘
/autofix build 실패 원인 고쳐줘
```

### Git

```text
현재 Git 상태 보여줘
최근 커밋 로그 보여줘
```

## Tool 실행 로그

CLI는 어느 단계에서 느린지 확인할 수 있도록 런타임 로그를 출력합니다.

예시:

```text
[agent] ollama:start messages=2 tools=15
[agent] ollama:end duration_ms=320
[agent] tool:start project-search__read_project_file args={"path":"README.md","maxChars":12000}
[agent] tool:end project-search__read_project_file duration_ms=8
```

이 로그로 구분할 수 있습니다.

- Ollama 응답이 느린지
- Tool 실행이 느린지
- 어떤 Tool에서 병목이 생기는지

## MCP 서버 개별 실행

보통은 에이전트가 자동으로 연결하므로 직접 실행할 필요는 없습니다.

필요하면:

```powershell
npm run server:memo
npm run server:todo
npm run server:project-search
npm run server:command
npm run server:build-test
npm run server:git
```

## 빌드 확인

```powershell
npm run build
```

## 테스트용 질문 예시

```text
workspace show
전체 분석하지 말고 루트 파일 목록만 보여줘
README.md 읽어줘
build.gradle 있어?
현재 프로젝트 구조 요약해줘
현재 워크스페이스에서 build_project 실행해줘
```

## 향후 개선 예정 기능

- `있어?`, `읽어줘`, `목록만`, `찾아줘` 계열 direct intent 추가 최적화
- 더 다양한 프로젝트 타입 자동 인식 강화
- Auto Fix Loop 품질 개선
- MCP Tool별 성능 캐시 적용
- 테스트 코드 및 회귀 검증 강화
- README / 설정 자동 동기화 보조 기능

## 참고

- 메모리 저장소는 JSON 기반입니다.
- OpenAI API 없이 로컬 Ollama만으로 동작합니다.
- Workspace는 런타임에 변경 가능하며, 이후 Tool은 새 Workspace 기준으로 동작합니다.
