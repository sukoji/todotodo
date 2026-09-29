const {app, BrowserWindow, dialog, ipcMain, Notification, session, systemPreferences} = require('electron');
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let window, server, baseURL, authToken, dbPath, settingsPath, timer;
const defaults = {alwaysOnTop: false, opacity: 100, notifications: true, reminderMinutes: 10};
let settings = {...defaults};
const notified = new Set();

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings = {...defaults, ...data};
  } catch { settings = {...defaults}; }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const executable = process.env.TODOTODO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    authToken = crypto.randomBytes(32).toString('hex');
    server = spawn(executable, ['-u', path.join(root, 'app.py')], {
      cwd: root, windowsHide: true,
      env: {...process.env, TODOTODO_DB: dbPath, TODOTODO_PORT: '0', TODOTODO_TOKEN: authToken},
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timeout = setTimeout(() => reject(new Error('로컬 데이터 서버가 시작되지 않았습니다.')), 12000);
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

async function requestAPI(endpoint, method = 'GET', body = null) {
  if (typeof endpoint !== 'string' || !/^\/api\/(items(?:\/[a-f0-9]{32})?|brief|export)(?:\?[\w%=&+.-]*)?$/.test(endpoint)) throw new Error('허용되지 않은 경로입니다.');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('허용되지 않은 요청입니다.');
  const response = await fetch(baseURL + endpoint, {
    method, headers: {'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json'},
    body: body == null ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '데이터 요청에 실패했습니다.');
  return data;
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
  } else throw new Error('알 수 없는 설정입니다.');
  settings[key] = value;
  saveSettings();
  if (key === 'alwaysOnTop' || key === 'opacity') applyWindowSettings();
  return settings;
}

async function checkReminders() {
  if (!settings.notifications || !Notification.isSupported()) return;
  try {
    const items = await requestAPI('/api/items');
    const now = Date.now();
    for (const item of items) {
      if (item.status === 'done' || !item.date || !item.time || item.kind === 'idea') continue;
      const start = new Date(`${item.date}T${item.time}:00`).getTime();
      const reminder = start - settings.reminderMinutes * 60000;
      const key = `${item.id}:${item.date}:${item.time}:${settings.reminderMinutes}`;
      if (now >= reminder && now < reminder + 60000 && !notified.has(key)) {
        notified.add(key);
        const notice = new Notification({title: item.title, body: settings.reminderMinutes ? `${settings.reminderMinutes}분 후 예정 · ${item.scope === 'work' ? '업무' : '개인'}` : '지금 예정된 일정입니다.'});
        notice.on('click', () => {window.show(); window.focus();});
        notice.show();
      }
    }
  } catch (error) { console.error('Reminder check failed:', error.message); }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 650, minHeight: 550,
    show: false, backgroundColor: '#faf7ee', title: 'TodoTodo', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}
  });
  applyWindowSettings();
  window.once('ready-to-show', () => {
    const motion = systemPreferences.getAnimationSettings();
    if (motion.prefersReducedMotion || !motion.shouldRenderRichAnimation) {window.show(); return;}
    const bounds = window.getBounds(), targetOpacity = settings.opacity / 100;
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
    };
    animate();
  });
  window.loadFile(path.join(root, 'static', 'index.html'));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (window) {window.show(); window.focus();}});
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.todotodo.desktop');
    dbPath = path.join(app.getPath('userData'), 'todotodo.db');
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    loadSettings();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await startServer();
    const verifySender = event => {
      if (!window || event.sender !== window.webContents || !event.senderFrame.url.startsWith('file:')) throw new Error('허용되지 않은 요청입니다.');
    };
    ipcMain.handle('todo:api', (event, endpoint, method, body) => {verifySender(event); return requestAPI(endpoint, method, body);});
    ipcMain.handle('todo:state', event => {verifySender(event); return {...settings, dbPath, root};});
    ipcMain.handle('todo:setting', (event, key, value) => {verifySender(event); return setSetting(key, value);});
    ipcMain.handle('todo:export', async event => {
      verifySender(event);
      const result = await dialog.showSaveDialog(window, {title: 'TodoTodo 백업', defaultPath: `todotodo-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{name: 'JSON', extensions: ['json']}]});
      if (result.canceled || !result.filePath) return false;
      const data = await requestAPI('/api/export');
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
      return true;
    });
    createWindow();
    timer = setInterval(checkReminders, 15000);
    checkReminders();
  }).catch(error => {
    console.error(error);
    const {dialog} = require('electron');
    dialog.showErrorBox('TodoTodo를 시작할 수 없습니다', `${error.message}\nPython 3.10 이상이 설치되어 있는지 확인하세요.`);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {if (timer) clearInterval(timer); if (server && !server.killed) server.kill();});
}
