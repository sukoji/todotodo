# TodoTodo

![TodoTodo 로고](static/logo.svg)

![TodoTodo 데스크톱 화면](docs/screenshot.png)

일정, 할 일, 아이디어를 한곳에 기록하고 기존 AI 에이전트와 함께 쓰는 로컬 우선 데스크톱 앱입니다. Electron 화면과 MCP 서버가 같은 SQLite 데이터베이스를 사용하므로, 사람이 화면에서 적은 내용을 에이전트가 읽고 에이전트가 남긴 내용을 화면에서 바로 볼 수 있습니다.

## 시작하기

Node.js/npm과 Python 3.10 이상이 필요합니다. Electron 데스크톱 앱을 실행하려면:

```bash
npm install
npm start
```

데스크톱 데이터는 운영체제의 TodoTodo 사용자 데이터 폴더에 저장됩니다. 앱의 **연결 및 설정** 화면에서 실제 DB 경로가 포함된 MCP 설정을 복사할 수 있습니다. 창 고정, 45~100% 투명도, 일정 시작 전 알림(정각/5/10/30분 전)을 지원합니다. 알림은 앱이 실행 중이고 운영체제 알림이 허용된 경우에 표시됩니다. 창 등장, 화면 전환, 완료 체크에는 짧은 모션을 적용했으며 운영체제의 동작 줄이기 설정을 따릅니다.

웹 버전으로도 실행할 수 있습니다. 이때 데이터는 프로젝트 폴더의 `todotodo.db`에 저장됩니다.

```bash
python app.py
```

브라우저에서 <http://127.0.0.1:8765>를 엽니다. 별도 데이터 위치를 쓰려면 `TODOTODO_DB` 환경 변수를 설정하세요. DB 파일은 Git에 포함되지 않습니다.

## 에이전트 연결

TodoTodo는 [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)의 stdio 서버를 제공합니다. MCP를 지원하는 클라이언트의 서버 설정에 다음처럼 등록하세요. `D:/Projects/todotodo`를 실제 프로젝트 절대 경로로 바꾸면 됩니다. `uv`가 없다면 `pip install "mcp>=2,<3"` 후 `python mcp_server.py`를 실행해도 됩니다.

```json
{
  "mcpServers": {
    "todotodo": {
      "command": "uv",
      "args": ["run", "--with", "mcp>=2,<3", "python", "mcp_server.py"],
      "cwd": "D:/Projects/todotodo"
    }
  }
}
```

데스크톱 앱의 데이터와 연결할 때는 위 설정에 `"env": {"TODOTODO_DB": "앱에 표시된 DB 경로"}`를 추가해야 합니다. **연결 및 설정** 화면에는 이 값이 포함된 설정 전체가 표시됩니다. 클라이언트마다 MCP 설정 파일의 위치와 최상위 키가 다를 수 있습니다. 외부 서비스 연결이나 API 키는 필요하지 않습니다.

| MCP 도구 | 용도 |
| --- | --- |
| `list_entries` | 종류, 업무/개인, 상태, 검색어로 목록 조회 |
| `get_entry` | ID로 항목 조회 |
| `capture_entry` | 할 일, 일정, 아이디어 기록 |
| `revise_entry` | 제목, 메모, 날짜, 시간, 우선순위, 태그, 상태 수정 |
| `mark_done` | 항목 완료 처리 |
| `get_daily_brief` | 오늘 일정, 미완료 기한 지난 일, 열린 아이디어 조회 |

예를 들어 에이전트에게 “다음 주 화요일 오후 2시에 업무 일정으로 고객 미팅 추가해줘”, “오늘 할 일과 밀린 일을 요약해줘”, “떠오른 아이디어를 개인 보관함에 적어줘”라고 요청할 수 있습니다. 날짜와 시간은 로컬 시간 기준입니다.

## 로컬 API

브라우저 외의 로컬 자동화에도 같은 데이터에 접근할 수 있습니다.

- `GET /api/items` — 전체 목록. `kind`, `scope`, `status`, `query`, `start`, `end` 필터 지원
- `POST /api/items` — 항목 추가
- `PATCH /api/items/{id}` — 항목 수정
- `DELETE /api/items/{id}` — 항목 삭제
- `GET /api/brief?day=YYYY-MM-DD` — 하루 브리핑
- `GET /api/export` — JSON 백업

예시:

```bash
curl -X POST http://127.0.0.1:8765/api/items \
  -H 'Content-Type: application/json' \
  -d '{"title":"회의 준비","kind":"task","scope":"work","date":"2026-10-01"}'
```

서버는 `127.0.0.1`에만 바인딩됩니다. Electron이 시작하는 내부 서버는 무작위 포트와 세션 토큰으로 보호됩니다. 다른 기기에서 접근하도록 공개할 계획이라면 별도 인증 및 HTTPS가 필요합니다.

## 백업과 실행 확인

화면의 **연결 및 설정 → JSON 백업 다운로드**에서 내보낼 수 있습니다. 자동 백업은 제공하지 않으므로 데이터 파일도 주기적으로 복사해 두세요.

```bash
python -m unittest discover -s tests -v
npm run check
```

## 설계 범위

개인과 업무 공간 구분, 할 일 상태, 일정 날짜·시간, 아이디어 메모, 간단한 검색과 태그, 로컬 JSON 백업, MCP 연동을 제공합니다. 계정 동기화, 반복 일정, 앱 종료 후 알림, 설치 파일은 아직 구현되지 않았습니다.
