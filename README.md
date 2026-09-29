<p align="center"><img src="static/logo.svg" width="76" alt="TodoTodo 로고"></p>

# TodoTodo

**할 일은 체크하고, 떠오른 생각은 붙여두고. 화면이 복잡해지면 접어두세요.**

TodoTodo는 책상 한쪽에 놓아두는 작은 수첩 같은 Windows 앱입니다. 일정·할 일·아이디어를 한곳에서 다루고, 필요할 때만 Codex나 Claude Desktop에 연결합니다. 가입, 동기화 서버, AI 연결 없이 바로 쓸 수 있습니다.

[**Windows용 다운로드**](https://github.com/sukoji/todotodo/releases/latest) · [화면 미리 보기](docs/screenshot.png)

![TodoTodo 화면](docs/screenshot.png)

## 하루에 맞춰 크기를 바꿔요

| 보기 | 쓰임 |
| --- | --- |
| 전체 창 | 할 일, 달력, 아이디어를 정리할 때 |
| 작은 메모 | 오늘 할 일 3개를 보며 바로 적거나 체크할 때 |
| 가장자리 탭 | 화면을 비워두고 로고만 왼쪽·오른쪽에 남길 때 |

![작은 메모 모드](docs/compact.png)

창 고정과 투명도(45–100%)를 조절할 수 있습니다. 시간이 있는 일정은 정각 또는 5·10·30분 전에 알림을 보냅니다. 모니터를 옮기거나 해상도가 바뀌면 창을 화면 안으로 맞춥니다. `Ctrl+Shift+M`으로 전체 창과 작은 메모를 전환할 수 있습니다.

## AI는 선택 사항이에요

TodoTodo의 기록과 알림은 AI 없이 로컬에서 동작합니다. 연결이 필요할 때는 **연결 및 설정**에서 방법을 고르세요.

| 연결 | 필요한 것 | 하는 일 |
| --- | --- | --- |
| Claude Desktop | 개인 Claude 로그인 + [TodoTodo 확장 파일](https://github.com/sukoji/todotodo/releases/latest) | Claude가 내 로컬 일정과 아이디어를 MCP로 읽고 기록 |
| Codex | 개인 ChatGPT 로그인 + 앱에 표시된 Codex 설정 | GPT 기반 Codex가 같은 로컬 MCP 도구 사용 |
| 앱 안의 AI 브리핑 | 개인 OpenAI 또는 Claude **API 키** | 오늘 일정 제목과 시간만 보내 실행 순서 제안 |

Claude Desktop에서는 **Settings → Extensions → Advanced settings → Install Extension…**에서 `todotodo-claude-win.mcpb`를 선택하세요. Codex에서는 앱의 **연결 및 설정 → Codex**에 표시되는 내용을 `~/.codex/config.toml`에 추가하세요. 두 경우 모두 앱이 실행 중일 필요는 없지만, 같은 컴퓨터의 TodoTodo 데이터 파일을 사용합니다.

앱 안의 AI 브리핑은 사용자가 버튼을 누를 때만 호출됩니다. API 키는 운영체제 보안 저장소로 암호화하며, 내용 전체나 메모 본문을 자동 전송하지 않습니다. **ChatGPT·Claude 구독은 각 서비스의 API 사용료를 포함하지 않습니다.** ChatGPT 웹사이트에 로컬 앱을 직접 연결하려면 별도의 공개 MCP 연결 또는 터널이 필요합니다. TodoTodo는 이를 대신하는 서버를 운영하지 않습니다.

## 다운로드 후 시작

1. [최신 릴리스](https://github.com/sukoji/todotodo/releases/latest)에서 `TodoTodo-*-portable.exe`를 내려받습니다.
2. 실행하면 바로 사용할 수 있습니다. 설치나 관리자 권한, Python·Node.js가 필요하지 않습니다.
3. 연결 없이 쓰다가 필요할 때만 Claude 확장이나 Codex 설정을 추가하세요.

Windows 배포 파일은 현재 코드 서명이 없습니다. 조직 PC에서는 실행 정책에 따라 차단될 수 있습니다. 배포 파일과 소스는 이 저장소의 릴리스에서 함께 확인할 수 있습니다.

데이터는 `%APPDATA%\TodoTodo\todotodo.db`에 저장됩니다. **연결 및 설정 → JSON 백업 다운로드**로 내보낼 수 있습니다. 계정 동기화, 앱 종료 후 알림, 반복 일정은 아직 없습니다.

## 개발자를 위한 실행 방법

Node.js/npm, Python 3.10+, `uv`가 필요합니다.

```bash
npm install
npm start
```

웹 화면만 실행하려면 `python app.py` 후 <http://127.0.0.1:8765>를 여세요. 소스 실행 시 기본 데이터 파일은 프로젝트 폴더의 `todotodo.db`입니다. `TODOTODO_DB`로 경로를 바꿀 수 있습니다.

MCP 서버만 실행하려면 `uv run python mcp_server.py`를 stdio 서버로 등록하세요. 도구는 `list_entries`, `get_entry`, `capture_entry`, `revise_entry`, `mark_done`, `get_daily_brief`입니다. 웹 API는 `GET/POST /api/items`, `PATCH/DELETE /api/items/{id}`, `GET /api/brief`, `GET /api/export`를 제공합니다.

```bash
npm run check
npm run build:win
```

Windows 배포 빌드는 PyInstaller로 데이터 서버·MCP 서버를 묶고, Electron portable 실행 파일과 Claude 확장 파일을 생성합니다. 결과는 `release/`에 저장됩니다.
