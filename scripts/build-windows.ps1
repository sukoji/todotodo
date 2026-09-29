$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { throw 'Windows에서 빌드하세요.' }

uv run --with pyinstaller --with 'mcp>=2,<3' python -m PyInstaller --noconfirm --clean --onefile --name todotodo-backend --distpath build/backend --workpath build/pyinstaller/backend --specpath build/pyinstaller app.py
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }

uv run --with pyinstaller --with 'mcp[cli]>=2,<3' python -m PyInstaller --noconfirm --clean --onefile --collect-all mcp --name todotodo-mcp --distpath build/backend --workpath build/pyinstaller/mcp --specpath build/pyinstaller mcp_server.py
if ($LASTEXITCODE -ne 0) { throw 'MCP build failed.' }

New-Item -ItemType Directory -Path 'build/mcpb/server' -Force | Out-Null
Copy-Item -LiteralPath 'build/backend/todotodo-mcp.exe' -Destination 'build/mcpb/server/todotodo-mcp.exe' -Force
Copy-Item -LiteralPath 'packaging/mcpb/manifest.json' -Destination 'build/mcpb/manifest.json' -Force
npx mcpb pack build/mcpb build/backend/todotodo-claude-win.mcpb
if ($LASTEXITCODE -ne 0) { throw 'Claude extension build failed.' }

npx electron-builder --win portable
if ($LASTEXITCODE -ne 0) { throw 'Electron build failed.' }
Copy-Item -LiteralPath 'build/backend/todotodo-claude-win.mcpb' -Destination 'release/todotodo-claude-win.mcpb' -Force
