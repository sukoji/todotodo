const {app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, screen, session, shell, systemPreferences} = require('electron');
const {spawn, spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {brief, providers} = require('./ai');
const {MAX_BACKUP_BYTES, BACKUP_INTERVAL_MS, backupStatus, saveAutoBackup} = require('./backup');
const {dueReminder, pruneReminderHistory} = require('./reminders');

const root = path.resolve(__dirname, '..');
app.setName('TodoTodo');
let window, edgeWindow, edgeDisplayId, server, baseURL, authToken, dbPath, settingsPath, secretsPath, backupFolder, timer, backupTimer, boundsTimer, movingByApp = false, backupRunning = false, rendererReady = false, closeApproved = false, quitting = false;
let pendingReminderId = null;
let backupState = {lastAt: null, count: 0};
const defaults = {alwaysOnTop: false, opacity: 100, notifications: true, reminderMinutes: 10, compact: false, edgeSide: 'right', edgeY: {}, normalBounds: {}, compactBounds: {}, lastDisplayId: null, reminderHistory: {}};
let settings = {...defaults};

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings = {...defaults, ...data};
  } catch { settings = {...defaults}; }
  if (!settings.edgeY || typeof settings.edgeY !== 'object' || Array.isArray(settings.edgeY)) settings.edgeY = {};
  settings.reminderHistory = pruneReminderHistory(settings.reminderHistory, Date.now());
}

function readSecrets() {
  try {return JSON.parse(fs.readFileSync(secretsPath, 'utf8'));}
  catch {return {};}
}

function saveProviderKey(provider, key) {
  if (!providers[provider] || typeof key !== 'string') throw new Error('AI 연결 정보를 확인하세요.');
  const secrets = readSecrets();
  if (key.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서 안전한 키 저장소를 사용할 수 없습니다.');
    secrets[provider] = safeStorage.encryptString(key.trim()).toString('base64');
  } else delete secrets[provider];
  fs.writeFileSync(secretsPath, JSON.stringify(secrets), {mode: 0o600});
  return {openai: Boolean(secrets.openai), anthropic: Boolean(secrets.anthropic)};
}

function providerKey(provider) {
  if (!providers[provider]) throw new Error('지원하지 않는 AI 제공자입니다.');
  const encrypted = readSecrets()[provider];
  if (!encrypted) throw new Error('먼저 API 키를 연결하세요.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('보안 저장소를 사용할 수 없습니다.');
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

async function makeAIBrief(provider, scope) {
  if (!['all', 'work', 'personal'].includes(scope)) throw new Error('공간 선택을 확인하세요.');
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const items = await requestAPI(`/api/items?start=${today}&end=${today}`);
  const selected = items.filter(item => item.status !== 'done' && item.kind !== 'idea' && (scope === 'all' || item.scope === scope));
  return brief(provider, providerKey(provider), selected);
}

function currentDisplay() {
  return screen.getDisplayMatching(window.getBounds());
}

function clampBounds(bounds, display, compact = false) {
  const area = display.workArea;
  const width = Math.min(area.width, Math.max(compact ? 300 : 650, bounds.width));
  const height = Math.min(area.height, Math.max(compact ? 250 : 550, bounds.height));
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width, height
  };
}

function rememberBounds() {
  if (!window || window.isDestroyed() || movingByApp || window.isMaximized()) return;
  const display = currentDisplay();
  const key = settings.compact ? 'compactBounds' : 'normalBounds';
  settings[key][String(display.id)] = window.getBounds();
  settings.lastDisplayId = display.id;
  saveSettings();
}

function resizeWindow(target) {
  const start = window.getBounds();
  const reduced = systemPreferences.getAnimationSettings().prefersReducedMotion;
  movingByApp = true;
  if (reduced) {window.setBounds(target); movingByApp = false; rememberBounds(); return;}
  const started = Date.now();
  const tick = () => {
    if (!window || window.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - started) / 280);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = key => Math.round(start[key] + (target[key] - start[key]) * eased);
    window.setBounds({x: value('x'), y: value('y'), width: value('width'), height: value('height')});
    if (t < 1) setTimeout(tick, 16);
    else {movingByApp = false; rememberBounds();}
  };
  tick();
}

function setCompact(value) {
  if (typeof value !== 'boolean') throw new Error('잘못된 창 모드입니다.');
  if (value === settings.compact) return settings;
  const display = currentDisplay(), id = String(display.id), area = display.workArea;
  const oldKey = settings.compact ? 'compactBounds' : 'normalBounds';
  if (!window.isMaximized()) settings[oldKey][id] = window.getBounds();
  settings.compact = value;
  const saved = settings[value ? 'compactBounds' : 'normalBounds'][id];
  const fallback = value
    ? {x: area.x + area.width - 352, y: area.y + area.height - 306, width: 336, height: 290}
    : {x: area.x + Math.round((area.width - 1180) / 2), y: area.y + Math.round((area.height - 780) / 2), width: 1180, height: 780};
  const target = clampBounds(saved || fallback, display, value);
  if (window.isMaximized()) window.unmaximize();
  window.setMinimumSize(Math.min(value ? 300 : 650, area.width), Math.min(value ? 250 : 550, area.height));
  window.webContents.send('todo:compact', value);
  resizeWindow(target);
  saveSettings();
  return settings;
}

function keepWindowVisible() {
  if (!window || window.isDestroyed()) return;
  const display = currentDisplay(), bounds = window.getBounds();
  window.setMinimumSize(Math.min(settings.compact ? 300 : 650, display.workArea.width), Math.min(settings.compact ? 250 : 550, display.workArea.height));
  const safe = clampBounds(bounds, display, settings.compact);
  if (JSON.stringify(bounds) !== JSON.stringify(safe)) window.setBounds(safe);
  if (edgeWindow && edgeWindow.isVisible()) positionEdge();
}

function positionEdge() {
  if (!edgeWindow || edgeWindow.isDestroyed()) return;
  const display = screen.getAllDisplays().find(item => item.id === edgeDisplayId) || screen.getPrimaryDisplay();
  edgeDisplayId = display.id;
  const area = display.workArea;
  const x = settings.edgeSide === 'left' ? area.x : area.x + area.width - 42;
  const fraction = settings.edgeY?.[String(display.id)];
  const y = area.y + Math.round((Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : .5) * Math.max(0, area.height - 64));
  const target = {x, y, width: 42, height: 64};
  if (JSON.stringify(edgeWindow.getBounds()) !== JSON.stringify(target)) edgeWindow.setBounds(target);
}

function moveEdge(y) {
  if (!edgeWindow || edgeWindow.isDestroyed() || !edgeWindow.isVisible() || !Number.isFinite(y)) return;
  const display = screen.getAllDisplays().find(item => item.id === edgeDisplayId) || screen.getPrimaryDisplay();
  const area = display.workArea;
  edgeWindow.setPosition(edgeWindow.getBounds().x, Math.max(area.y, Math.min(Math.round(y), area.y + area.height - 64)));
}

function rememberEdgePosition() {
  if (!edgeWindow || edgeWindow.isDestroyed()) return;
  const display = screen.getAllDisplays().find(item => item.id === edgeDisplayId) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const fraction = (edgeWindow.getBounds().y - area.y) / Math.max(1, area.height - 64);
  settings.edgeY[String(display.id)] = Math.max(0, Math.min(1, fraction));
  saveSettings();
}

function foldToEdge() {
  edgeDisplayId = currentDisplay().id;
  if (!edgeWindow || edgeWindow.isDestroyed()) {
    edgeWindow = new BrowserWindow({
      width: 42, height: 64, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: {preload: path.join(__dirname, 'edge-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}
    });
    edgeWindow.loadFile(path.join(root, 'static', 'edge.html'));
    edgeWindow.webContents.on('will-navigate', event => event.preventDefault());
    edgeWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  }
  positionEdge();
  window.hide();
  edgeWindow.show();
}

function restoreFromEdge() {
  if (edgeWindow) edgeWindow.hide();
  keepWindowVisible();
  window.show();
  window.focus();
}

function startServer() {
  return new Promise((resolve, reject) => {
    const executable = app.isPackaged ? path.join(process.resourcesPath, 'backend', 'todotodo-backend.exe') : (process.env.TODOTODO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'));
    const args = app.isPackaged ? [] : ['-u', path.join(root, 'app.py')];
    authToken = crypto.randomBytes(32).toString('hex');
    server = spawn(executable, args, {
      cwd: app.isPackaged ? process.resourcesPath : root, windowsHide: true,
      env: {...process.env, PYTHONUNBUFFERED: '1', TODOTODO_DB: dbPath, TODOTODO_PORT: '0', TODOTODO_TOKEN: authToken},
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timeout = setTimeout(() => reject(new Error('로컬 데이터 서버가 시작되지 않았습니다.')), app.isPackaged ? 30000 : 12000);
    server.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/TodoTodo: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); baseURL = match[1]; resolve(); }
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.on('error', error => {clearTimeout(timeout); reject(error);});
    server.on('exit', code => {if (!baseURL) {clearTimeout(timeout); reject(new Error(`데이터 서버 종료: ${code}`));}});
  });
}

function agentExecutable() {
  const source = path.join(process.resourcesPath, 'backend', 'todotodo-mcp.exe');
  if (!process.env.PORTABLE_EXECUTABLE_DIR) return source;
  const folder = path.join(app.getPath('userData'), 'agents', app.getVersion());
  const destination = path.join(folder, 'todotodo-mcp.exe');
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(folder, {recursive: true});
    fs.copyFileSync(source, destination);
  }
  return destination;
}

async function requestAPI(endpoint, method = 'GET', body = null) {
  if (typeof endpoint !== 'string' || !/^\/api\/(items(?:\/[a-f0-9]{32})?|brief|export|import)(?:\?[\w%=&+.-]*)?$/.test(endpoint)) throw new Error('허용되지 않은 경로입니다.');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('허용되지 않은 요청입니다.');
  const response = await fetch(baseURL + endpoint, {
    method, headers: {'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json'},
    body: body == null ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {const error = new Error(data.error || '데이터 요청에 실패했습니다.'); error.status = response.status; throw error;}
  return data;
}

async function checkAutoBackup(force = false) {
  if (backupRunning) return {...backupState, busy: true};
  backupRunning = true;
  try {backupState = {...await saveAutoBackup(backupFolder, () => requestAPI('/api/export'), new Date(), force), error: null};}
  catch (error) {console.error('Automatic backup failed:', error); backupState = {...backupState, error: error.message};}
  finally {
    backupRunning = false;
    if (window && !window.isDestroyed()) window.webContents.send('todo:backup-status', backupState);
  }
  return backupState;
}

function applyWindowSettings() {
  window.setAlwaysOnTop(Boolean(settings.alwaysOnTop));
  window.setOpacity(settings.opacity / 100);
}

function setSetting(key, value) {
  if (key === 'alwaysOnTop' || key === 'notifications') {
    if (typeof value !== 'boolean') throw new Error('잘못된 설정 값입니다.');
  } else if (key === 'opacity') {
    if (!Number.isInteger(value) || value < 45 || value > 100) throw new Error('투명도 범위를 확인하세요.');
  } else if (key === 'reminderMinutes') {
    if (![0, 5, 10, 30].includes(value)) throw new Error('알림 시점을 확인하세요.');
  } else if (key === 'edgeSide') {
    if (!['left', 'right'].includes(value)) throw new Error('창 가장자리를 확인하세요.');
  } else throw new Error('알 수 없는 설정입니다.');
  settings[key] = value;
  saveSettings();
  if (key === 'alwaysOnTop' || key === 'opacity') applyWindowSettings();
  if (key === 'edgeSide') positionEdge();
  return settings;
}

async function checkReminders() {
  if (!settings.notifications || !Notification.isSupported()) return;
  try {
    const dateKey = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const today = new Date(), yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const items = await requestAPI(`/api/items?start=${dateKey(yesterday)}&end=${dateKey(tomorrow)}`);
    const now = Date.now();
    for (const item of items) {
      const reminder = dueReminder(item, now, settings.reminderMinutes);
      if (reminder && !settings.reminderHistory[reminder.key]) {
        const notice = new Notification({title: item.title, body: reminder.body});
        notice.on('click', () => {
          if (edgeWindow?.isVisible()) restoreFromEdge();
          else {if (window.isMinimized()) window.restore(); window.show(); window.focus();}
          if (settings.compact) setCompact(false);
          if (rendererReady) window.webContents.send('todo:reminder-open', item.id);
          else pendingReminderId = item.id;
        });
        notice.show();
        settings.reminderHistory = pruneReminderHistory(settings.reminderHistory, now);
        settings.reminderHistory[reminder.key] = now;
        saveSettings();
      }
    }
  } catch (error) { console.error('Reminder check failed:', error.message); }
}

function createWindow() {
  const display = screen.getAllDisplays().find(item => item.id === settings.lastDisplayId) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const defaultBounds = settings.compact
    ? {x: area.x + area.width - 352, y: area.y + area.height - 306, width: 336, height: 290}
    : {x: area.x + Math.round((area.width - 1180) / 2), y: area.y + Math.round((area.height - 780) / 2), width: 1180, height: 780};
  const bounds = clampBounds((settings.compact ? settings.compactBounds : settings.normalBounds)[String(display.id)] || defaultBounds, display, settings.compact);
  window = new BrowserWindow({
    ...bounds, minWidth: Math.min(settings.compact ? 300 : 650, area.width), minHeight: Math.min(settings.compact ? 250 : 550, area.height),
    show: false, frame: false, backgroundColor: '#faf7ee', title: 'TodoTodo', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}
  });
  applyWindowSettings();
  window.once('ready-to-show', () => {
    const motion = systemPreferences.getAnimationSettings();
    if (motion.prefersReducedMotion || !motion.shouldRenderRichAnimation) {window.show(); return;}
    const bounds = window.getBounds(), targetOpacity = settings.opacity / 100;
    movingByApp = true;
    window.setPosition(bounds.x, bounds.y + 12);
    window.setOpacity(targetOpacity * .82);
    window.show();
    const started = Date.now();
    const animate = () => {
      if (!window || window.isDestroyed()) return;
      const t = Math.min(1, (Date.now() - started) / 240);
      const eased = 1 - Math.pow(1 - t, 3);
      window.setPosition(bounds.x, Math.round(bounds.y + 12 * (1 - eased)));
      window.setOpacity(targetOpacity * (.82 + .18 * eased));
      if (t < 1) setTimeout(animate, 16);
      else {movingByApp = false; rememberBounds();}
    };
    animate();
  });
  window.loadFile(path.join(root, 'static', 'loading.html'));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('did-start-loading', () => {rendererReady = false;});
  window.webContents.on('render-process-gone', () => {rendererReady = false;});
  const scheduleBoundsSave = () => {clearTimeout(boundsTimer); boundsTimer = setTimeout(rememberBounds, 350);};
  window.on('move', scheduleBoundsSave);
  window.on('resize', scheduleBoundsSave);
  window.on('close', event => {
    if (closeApproved || !rendererReady || window.webContents.isDestroyed()) return;
    event.preventDefault();
    window.webContents.send('todo:close-request');
  });
  window.on('closed', () => {if (edgeWindow && !edgeWindow.isDestroyed()) edgeWindow.close(); app.quit();});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (edgeWindow?.isVisible()) restoreFromEdge(); else if (window) {window.show(); window.focus();}});
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.todotodo.desktop');
    dbPath = path.join(app.getPath('userData'), 'todotodo.db');
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    secretsPath = path.join(app.getPath('userData'), 'ai-keys.json');
    backupFolder = path.join(app.getPath('userData'), 'backups');
    loadSettings();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    createWindow();
    try {backupState = await backupStatus(backupFolder);} catch (error) {backupState.error = error.message;}
    await startServer();
    if (quitting) return;
    const verifySender = event => {
      if (!window || event.sender !== window.webContents || !event.senderFrame.url.startsWith('file:')) throw new Error('허용되지 않은 요청입니다.');
    };
    ipcMain.handle('todo:api', async (event, endpoint, method, body) => {
      verifySender(event);
      try {return {ok: true, data: await requestAPI(endpoint, method, body)};}
      catch (error) {return {ok: false, error: error.message, status: error.status || 500};}
    });
    ipcMain.handle('todo:state', event => {
      verifySender(event);
      rendererReady = true;
      const reminderId = pendingReminderId;
      pendingReminderId = null;
      const mcpConfig = app.isPackaged
        ? {command: agentExecutable(), args: [], env: {TODOTODO_DB: dbPath}}
        : {command: 'uv', args: ['run', '--with', 'mcp>=2,<3', 'python', 'mcp_server.py'], cwd: root, env: {TODOTODO_DB: dbPath}};
      return {...settings, dbPath, mcpConfig, backup: backupState, claudeBundleAvailable: app.isPackaged, reminderId};
    });
    ipcMain.handle('todo:backup-folder', async event => {
      verifySender(event);
      await fs.promises.mkdir(backupFolder, {recursive: true});
      const error = await shell.openPath(backupFolder);
      if (error) throw new Error(error);
      return true;
    });
    ipcMain.handle('todo:backup-now', event => {verifySender(event); return checkAutoBackup(true);});
    ipcMain.handle('todo:setting', (event, key, value) => {verifySender(event); return setSetting(key, value);});
    ipcMain.handle('todo:ai-status', event => {verifySender(event); const keys = readSecrets(); return {openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic)};});
    ipcMain.handle('todo:ai-key', (event, provider, key) => {verifySender(event); return saveProviderKey(provider, key);});
    ipcMain.handle('todo:ai-brief', (event, provider, scope) => {verifySender(event); return makeAIBrief(provider, scope);});
    ipcMain.handle('todo:claude-bundle', event => {
      verifySender(event);
      if (!app.isPackaged) return false;
      const bundle = path.join(process.resourcesPath, 'backend', 'todotodo-claude-win.mcpb');
      if (!fs.existsSync(bundle)) return false;
      shell.showItemInFolder(bundle);
      return true;
    });
    ipcMain.handle('todo:compact', (event, value) => {verifySender(event); return setCompact(value);});
    ipcMain.handle('todo:window-control', (event, action) => {
      verifySender(event);
      if (action === 'minimize') window.minimize();
      else if (action === 'maximize') {if (window.isMaximized()) window.unmaximize(); else window.maximize();}
      else if (action === 'close') window.close();
      else if (action === 'confirm-close') {closeApproved = true; setImmediate(() => window.close());}
      else throw new Error('Unknown window action');
    });
    ipcMain.handle('todo:fold', event => {verifySender(event); foldToEdge(); return true;});
    ipcMain.handle('edge:restore', event => {if (!edgeWindow || event.sender !== edgeWindow.webContents) throw new Error('허용되지 않은 요청입니다.'); restoreFromEdge();});
    ipcMain.handle('edge:side', event => {if (!edgeWindow || event.sender !== edgeWindow.webContents) throw new Error('허용되지 않은 요청입니다.'); return settings.edgeSide;});
    ipcMain.on('edge:move', (event, y) => {if (edgeWindow && event.sender === edgeWindow.webContents) moveEdge(y);});
    ipcMain.on('edge:drop', event => {if (edgeWindow && event.sender === edgeWindow.webContents) rememberEdgePosition();});
    ipcMain.handle('todo:export', async event => {
      verifySender(event);
      const result = await dialog.showSaveDialog(window, {title: 'TodoTodo 백업', defaultPath: `todotodo-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{name: 'JSON', extensions: ['json']}]});
      if (result.canceled || !result.filePath) return false;
      const data = await requestAPI('/api/export');
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
      return true;
    });
    ipcMain.handle('todo:import', async event => {
      verifySender(event);
      const selection = await dialog.showOpenDialog(window, {title: 'TodoTodo 백업 가져오기', properties: ['openFile'], filters: [{name: 'JSON', extensions: ['json']} ]});
      if (selection.canceled || !selection.filePaths[0]) return null;
      const file = selection.filePaths[0];
      if ((await fs.promises.stat(file)).size > MAX_BACKUP_BYTES) throw new Error('100MB 이하의 백업 파일만 가져올 수 있습니다.');
      let data;
      try {data = JSON.parse(await fs.promises.readFile(file, 'utf8'));}
      catch {throw new Error('JSON 백업 파일을 읽을 수 없습니다.');}
      if (!['todotodo-v1', 'todotodo-v2', 'todotodo-v3'].includes(data?.format) || !Array.isArray(data.items)) throw new Error('TodoTodo 백업 파일이 아닙니다.');
      const choice = await dialog.showMessageBox(window, {
        type: 'question', title: '백업 가져오기', message: `${data.items.length}개 항목을 가져올까요?`,
        detail: '기존 기록은 그대로 두고, 같은 항목은 건너뜁니다.',
        buttons: ['가져오기', '취소'], defaultId: 1, cancelId: 1, noLink: true
      });
      if (choice.response !== 0) return null;
      return requestAPI('/api/import', 'POST', data);
    });
    await window.loadFile(path.join(root, 'static', 'index.html'));
    screen.on('display-metrics-changed', keepWindowVisible);
    screen.on('display-removed', keepWindowVisible);
    timer = setInterval(checkReminders, 15000);
    checkReminders();
    backupTimer = setInterval(checkAutoBackup, BACKUP_INTERVAL_MS);
    checkAutoBackup();
  }).catch(error => {
    if (quitting) return;
    console.error(error);
    const guidance = app.isPackaged
      ? '앱을 다시 실행해 보세요. 계속 실패하면 설치 파일을 다시 실행하거나 ZIP을 새 폴더에 다시 풀어 주세요. 저장된 기록은 유지됩니다.'
      : 'Python 3.10 이상이 설치되어 있는지 확인하세요.';
    dialog.showErrorBox('TodoTodo를 시작할 수 없습니다', `${error.message}\n${guidance}`);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    if (timer) clearInterval(timer);
    if (backupTimer) clearInterval(backupTimer);
    if (boundsTimer) clearTimeout(boundsTimer);
    if (server && !server.killed) {
      if (process.platform === 'win32' && server.pid) {
        const stopped = spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore', timeout: 5000});
        if (stopped.status !== 0) server.kill();
      } else server.kill();
    }
  });
}
