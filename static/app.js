const $ = selector => document.querySelector(selector);
const state = {items: [], view: 'home', scope: 'all', taskFilter: 'open', search: '', editing: null, month: new Date(), selectedDay: localDate(new Date())};
let desktopCompact = false;
const kindName = {task: '할 일', event: '일정', idea: '아이디어'};
const scopeName = {work: '업무', personal: '개인'};

function localDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function formatDate(value) {
  if (!value) return '';
  const [y,m,d] = value.split('-').map(Number);
  return `${m}월 ${d}일`;
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3000);
}
async function api(path, options = {}) {
  if (window.todoDesktop) return window.todoDesktop.api(path, options.method || 'GET', options.body ? JSON.parse(options.body) : null);
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '요청에 실패했습니다.');
  return body;
}
async function refresh() {
  try { state.items = await api('/api/items'); render(); }
  catch (error) { toast(error.message); }
}
function scoped(items) { return state.scope === 'all' ? items : items.filter(item => item.scope === state.scope); }
function openItems(items) { return items.filter(item => item.status !== 'done'); }
function row(item, showDate = true) {
  const complete = item.status === 'done';
  const meta = [scopeName[item.scope], kindName[item.kind], item.time || '', item.tags || ''].filter(Boolean);
  return `<div class="item-row ${complete ? 'is-done' : ''}"><button class="check-button ${complete ? 'done' : ''}" data-complete="${item.id}" aria-label="${complete ? '완료 취소' : '완료'}">${complete ? '✓' : ''}</button><div class="item-body" data-edit="${item.id}"><div class="item-title">${escapeHTML(item.title)} ${item.priority === 'high' ? '<i class="priority-high" title="높은 우선순위"></i>' : ''}</div><div class="item-meta">${meta.map(text => `<span>${escapeHTML(text)}</span>`).join('<span>·</span>')}</div></div>${showDate && item.date ? `<span class="item-date">${formatDate(item.date)}</span>` : ''}</div>`;
}
function empty(message) { return `<div class="empty-state"><img class="empty-illustration" src="./empty.svg" alt="">${message}</div>`; }
function render() {
  const items = scoped(state.items), today = localDate(new Date());
  const dueToday = openItems(items.filter(item => item.date === today));
  const activeTasks = openItems(items.filter(item => item.kind === 'task'));
  const openIdeas = openItems(items.filter(item => item.kind === 'idea'));
  $('#today-label').textContent = new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  $('#greeting').textContent = '오늘도 하나씩,';
  $('#stat-today').textContent = dueToday.length;
  $('#stat-doing').textContent = items.filter(item => item.status === 'doing').length;
  $('#stat-ideas').textContent = openIdeas.length;
  $('#today-count').textContent = dueToday.length;
  const todayList = [...dueToday].sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  $('#today-list').innerHTML = todayList.length ? todayList.map(item => row(item, false)).join('') : empty('오늘 예정된 항목이 없어요.<br>새로운 하루를 계획해 보세요.');
  const upcoming = openItems(items.filter(item => item.date > today)).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0, 3);
  $('#upcoming-list').innerHTML = upcoming.length ? upcoming.map(item => row(item)).join('') : empty('다가오는 일정이 없어요.');
  renderTasks(items); renderIdeas(items); renderCalendar(items); renderCompact(items);
}
function renderCompact(items) {
  const today = localDate(new Date());
  const active = openItems(items.filter(item => item.kind === 'task' || item.kind === 'event'));
  const candidates = active.filter(item => !item.date || item.date <= today).sort((a,b) => {
    const rank = item => item.date && item.date < today ? 0 : item.date === today ? 1 : 2;
    return rank(a) - rank(b) || (a.time || '99:99').localeCompare(b.time || '99:99');
  });
  $('#compact-count').textContent = `${candidates.length}개 남음`;
  $('#compact-list').innerHTML = candidates.length ? candidates.slice(0,3).map(item => `<div class="compact-row"><button class="check-button" data-complete="${item.id}" aria-label="완료"></button><button class="compact-title" data-compact-edit="${item.id}">${escapeHTML(item.title)}</button>${item.time ? `<small>${escapeHTML(item.time)}</small>` : ''}</div>`).join('') : '<div class="compact-empty">오늘은 여유로운 페이지예요 ☀</div>';
}
function renderTasks(items) {
  let results = items.filter(item => item.kind === 'task');
  if (state.search) results = items.filter(item => `${item.title} ${item.details} ${item.tags}`.toLowerCase().includes(state.search.toLowerCase()));
  else if (state.taskFilter === 'open') results = openItems(results);
  else if (state.taskFilter === 'done') results = results.filter(item => item.status === 'done');
  $('#task-total').textContent = `${results.length}개 항목${state.search ? ` · “${state.search}” 검색` : ''}`;
  $('#tasks-list').innerHTML = results.length ? results.map(item => row(item)).join('') : empty(state.search ? '검색 결과가 없어요.' : '아직 할 일이 없어요.<br>첫 번째 할 일을 추가해 보세요.');
}
function renderIdeas(items) {
  const ideas = items.filter(item => item.kind === 'idea').sort((a,b) => b.created_at.localeCompare(a.created_at));
  $('#ideas-grid').innerHTML = ideas.length ? ideas.map(item => `<article class="idea-card" data-edit="${item.id}" tabindex="0"><div class="idea-card-top"><span>✦</span><small>${formatDate(item.created_at.slice(0,10))}</small></div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.details || '메모를 추가해 보세요.')}</p><div class="idea-card-footer">${scopeName[item.scope]} ${item.tags ? '· ' + escapeHTML(item.tags) : ''}</div></article>`).join('') : empty('아이디어를 자유롭게 기록해 보세요.<br>에이전트가 남긴 아이디어도 이곳에 모입니다.');
}
function renderCalendar(items) {
  const month = state.month.getMonth(), year = state.month.getFullYear();
  $('#calendar-month').textContent = `${year}년 ${month+1}월`;
  const first = new Date(year, month, 1).getDay(), days = new Date(year, month+1, 0).getDate();
  const cells = Math.ceil((first+days)/7)*7;
  $('#calendar-grid').innerHTML = Array.from({length:cells}, (_,index) => {
    const current = new Date(year, month, index-first+1), day = localDate(current);
    const matches = items.filter(item => item.date === day);
    return `<button class="calendar-day ${current.getMonth() !== month ? 'outside' : ''} ${day === state.selectedDay ? 'selected' : ''} ${day === localDate(new Date()) ? 'today' : ''}" data-day="${day}"><span class="day-number">${current.getDate()}</span>${matches.slice(0,2).map(item => `<span class="calendar-dot ${item.kind === 'event' ? 'event' : ''}">${escapeHTML(item.title)}</span>`).join('')}</button>`;
  }).join('');
  const selected = new Date(`${state.selectedDay}T12:00:00`);
  $('#selected-day-title').textContent = new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(selected);
  const dayItems = items.filter(item => item.date === state.selectedDay).sort((a,b) => a.time.localeCompare(b.time));
  $('#selected-day-list').innerHTML = dayItems.length ? dayItems.map(item => row(item,false)).join('') : empty('이날의 일정이 없어요.');
}
function setView(view) {
  state.view = view; state.search = view === 'tasks' ? state.search : '';
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `${view}-view`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-current').textContent = {home:'오늘',tasks:'할 일',calendar:'캘린더',ideas:'아이디어 보관함',connect:'에이전트 연결'}[view];
}
function openEditor(kind = 'task', item = null) {
  state.editing = item;
  const form = $('#editor-form'); form.reset();
  form.elements.kind.value = item?.kind || kind;
  for (const key of ['title','details','date','time','scope','priority','tags']) if (item) form.elements[key].value = item[key] || '';
  if (!item && kind === 'event') form.elements.date.value = state.selectedDay;
  if (!item && state.scope !== 'all') form.elements.scope.value = state.scope;
  $('#dialog-title').textContent = item ? '항목 수정' : '새 항목 만들기';
  $('#delete-button').hidden = !item;
  $('#editor').showModal();
  form.elements.title.focus();
}
document.addEventListener('click', async event => {
  const view = event.target.closest('[data-view]'); if (view) return setView(view.dataset.view);
  const create = event.target.closest('[data-new]'); if (create) return openEditor(create.dataset.new);
  const scope = event.target.closest('[data-scope]'); if (scope) {state.scope = scope.dataset.scope; document.querySelectorAll('[data-scope]').forEach(el => el.classList.toggle('selected',el === scope)); return render();}
  const filter = event.target.closest('[data-filter]'); if (filter) {state.taskFilter = filter.dataset.filter; state.search = ''; document.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('selected',el === filter)); return render();}
  const day = event.target.closest('[data-day]'); if (day) {state.selectedDay = day.dataset.day; return render();}
  const compactEdit = event.target.closest('[data-compact-edit]'); if (compactEdit) {
    const item = state.items.find(entry => entry.id === compactEdit.dataset.compactEdit);
    await toggleCompact(false); setTimeout(() => openEditor(item.kind,item), 300); return;
  }
  const edit = event.target.closest('[data-edit]'); if (edit) return openEditor('task',state.items.find(item => item.id === edit.dataset.edit));
  const complete = event.target.closest('[data-complete]'); if (complete) {
    const item = state.items.find(entry => entry.id === complete.dataset.complete);
    const rowElement = complete.closest('.item-row, .compact-row');
    if (item.status !== 'done' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      complete.classList.add('done'); complete.textContent = '✓';
      rowElement.classList.add('completing');
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    try {await api(`/api/items/${item.id}`,{method:'PATCH',body:JSON.stringify({status:item.status === 'done' ? 'todo' : 'done'})}); await refresh();} catch(error) {rowElement.classList.remove('completing'); toast(error.message);}
  }
});
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  try {
    await api(state.editing ? `/api/items/${state.editing.id}` : '/api/items',{method:state.editing ? 'PATCH' : 'POST',body:JSON.stringify(data)});
    $('#editor').close(); toast(state.editing ? '수정했습니다.' : '기록했습니다.'); await refresh();
  } catch(error) {toast(error.message);}
});
$('#close-dialog').onclick = $('#cancel-button').onclick = () => $('#editor').close();
$('#delete-button').onclick = async () => {
  if (!state.editing || !confirm('이 항목을 삭제할까요?')) return;
  try {await api(`/api/items/${state.editing.id}`,{method:'DELETE'}); $('#editor').close(); toast('삭제했습니다.'); await refresh();}
  catch(error) {toast(error.message);}
};
$('#prev-month').onclick = () => {state.month = new Date(state.month.getFullYear(),state.month.getMonth()-1,1); render();};
$('#next-month').onclick = () => {state.month = new Date(state.month.getFullYear(),state.month.getMonth()+1,1); render();};
$('#go-today').onclick = () => {state.month = new Date(); state.selectedDay = localDate(new Date()); render();};
async function toggleCompact(value = !desktopCompact) {
  if (!window.todoDesktop) return;
  try {await window.todoDesktop.compact(value);} catch(error) {toast(error.message);}
}
$('#compact-button').onclick = () => toggleCompact(true);
$('#expand-button').onclick = () => toggleCompact(false);
$('#fold-button').onclick = $('#compact-fold').onclick = async () => {try {await window.todoDesktop.fold();} catch(error) {toast(error.message);}};
document.querySelectorAll('[data-window-action]').forEach(button => {
  button.onclick = async () => {try {await window.todoDesktop.windowControl(button.dataset.windowAction);} catch(error) {toast(error.message);}};
});
$('#compact-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('#compact-input'), title = input.value.trim();
  if (!title) return;
  try {await api('/api/items',{method:'POST',body:JSON.stringify({title,kind:'task',scope:state.scope === 'all' ? 'personal' : state.scope,date:localDate(new Date())})}); input.value = ''; await refresh(); toast('오늘 페이지에 적었어요.');}
  catch(error) {toast(error.message);}
};
$('#search-button').onclick = () => {const query = prompt('제목, 메모, 태그에서 검색',state.search); if (query === null) return; state.search = query.trim(); setView('tasks'); render();};
$('#copy-command').onclick = async () => {try {await navigator.clipboard.writeText($('#mcp-command').textContent); toast('설정을 복사했습니다.');} catch {toast('복사할 수 없습니다. 내용을 직접 선택해 주세요.');}};
$('#export-button').onclick = async () => {
  try {if (window.todoDesktop) {if (await window.todoDesktop.export()) toast('백업을 저장했습니다.'); return;} const data = await api('/api/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const link = document.createElement('a'); link.href = url; link.download = `todotodo-backup-${localDate(new Date())}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);}
  catch(error) {toast(error.message);}
};
async function initializeDesktop() {
  if (!window.todoDesktop) return;
  document.body.classList.add('desktop-app');
  const preferences = await window.todoDesktop.state();
  const config = {mcpServers:{todotodo:preferences.mcpConfig}};
  const toml = `[mcp_servers.todotodo]\ncommand = ${JSON.stringify(preferences.mcpConfig.command)}\nargs = ${JSON.stringify(preferences.mcpConfig.args)}\n[mcp_servers.todotodo.env]\nTODOTODO_DB = ${JSON.stringify(preferences.dbPath)}`;
  $('#mcp-command').insertAdjacentHTML('beforebegin', '<div class="connection-tabs"><button class="selected" id="claude-config-tab">Claude Desktop</button><button id="codex-config-tab">Codex</button></div>');
  const showConfig = mode => {
    $('#mcp-command').textContent = mode === 'codex' ? toml : JSON.stringify(config,null,2);
    $('#claude-config-tab').classList.toggle('selected',mode === 'claude');
    $('#codex-config-tab').classList.toggle('selected',mode === 'codex');
  };
  $('#claude-config-tab').onclick = () => showConfig('claude');
  $('#codex-config-tab').onclick = () => showConfig('codex');
  showConfig('claude');
  if (preferences.claudeBundleAvailable) {
    $('#copy-command').insertAdjacentHTML('afterend','<button class="subtle-button bundle-button" id="claude-bundle-button">Claude 확장 파일 찾기 ↗</button>');
    $('#claude-bundle-button').onclick = async () => {if (await window.todoDesktop.claudeBundle()) toast('파일을 찾았습니다. Claude Desktop에서 확장을 설치하세요.'); else toast('확장 파일을 찾을 수 없습니다.');};
  }
  $('#always-on-top').checked = preferences.alwaysOnTop;
  $('#opacity-slider').value = preferences.opacity;
  $('#opacity-value').textContent = `${preferences.opacity}%`;
  $('#notifications-enabled').checked = preferences.notifications;
  $('#reminder-minutes').value = String(preferences.reminderMinutes);
  $('#desktop-settings').insertAdjacentHTML('beforeend', '<label class="setting-row"><span><strong>가장자리 탭 위치</strong><small>접어둘 모니터의 왼쪽 또는 오른쪽</small></span><select id="edge-side"><option value="right">오른쪽</option><option value="left">왼쪽</option></select></label>');
  $('#edge-side').value = preferences.edgeSide;
  $('#pin-button').classList.toggle('active',preferences.alwaysOnTop);
  $('#compact-pin').classList.toggle('active',preferences.alwaysOnTop);
  desktopCompact = preferences.compact;
  document.body.classList.toggle('compact-app', desktopCompact);
  window.todoDesktop.onCompactChanged(value => {desktopCompact = value; document.body.classList.toggle('compact-app', value); refresh();});
  const save = async (key,value) => {
    try {
      const updated = await window.todoDesktop.setting(key,value);
      $('#pin-button').classList.toggle('active',updated.alwaysOnTop);
      $('#compact-pin').classList.toggle('active',updated.alwaysOnTop);
      $('#always-on-top').checked = updated.alwaysOnTop;
      $('#opacity-value').textContent = `${updated.opacity}%`;
      toast('설정을 저장했습니다.');
    } catch(error) {toast(error.message);}
  };
  $('#pin-button').onclick = () => save('alwaysOnTop',!$('#always-on-top').checked);
  $('#compact-pin').onclick = () => save('alwaysOnTop',!$('#always-on-top').checked);
  $('#always-on-top').onchange = event => save('alwaysOnTop',event.target.checked);
  $('#opacity-slider').oninput = event => {$('#opacity-value').textContent = `${event.target.value}%`;};
  $('#opacity-slider').onchange = event => save('opacity',Number(event.target.value));
  $('#notifications-enabled').onchange = event => save('notifications',event.target.checked);
  $('#reminder-minutes').onchange = event => save('reminderMinutes',Number(event.target.value));
  $('#edge-side').onchange = event => save('edgeSide',event.target.value);
  $('#desktop-settings').insertAdjacentHTML('afterend', `<div class="panel connect-panel" id="ai-settings"><div class="connect-symbol">✎</div><h2>선택해서 쓰는 AI</h2><p>연결하지 않아도 TodoTodo의 모든 기본 기능을 쓸 수 있어요. 키를 등록하면 오늘 일정의 제목과 시간만 직접 요청할 때 전송합니다.</p><label class="field">제공자<select id="ai-provider"><option value="openai">OpenAI API · GPT</option><option value="anthropic">Claude API</option></select></label><label class="field">개인 API 키<input id="ai-key-input" type="password" autocomplete="off" placeholder="API 키를 입력하세요"></label><div class="ai-key-actions"><button class="subtle-button" id="save-ai-key">안전하게 저장</button><button class="subtle-button" id="remove-ai-key">연결 해제</button><span id="ai-key-status"></span></div><p class="connect-note">키는 운영체제 보안 저장소로 암호화됩니다. ChatGPT·Claude 구독과 API 사용료는 별개예요. 기존 계정으로 쓰려면 위 MCP 설정을 Codex 또는 Claude Desktop에 등록하세요.</p></div>`);
  $('#home-view .page-heading p').insertAdjacentHTML('afterend','<button class="ai-brief-button" id="ai-brief-button">✳ AI에게 오늘의 순서 묻기</button>');
  $('#ai-provider').value = localStorage.getItem('todo-provider') || 'openai';
  let keyStatus = await window.todoDesktop.aiStatus();
  const updateKeyStatus = () => {const connected = keyStatus[$('#ai-provider').value]; $('#ai-key-status').textContent = connected ? '● 연결됨' : '○ 연결 안 됨'; $('#ai-key-status').classList.toggle('connected',connected);};
  $('#ai-provider').onchange = () => {localStorage.setItem('todo-provider',$('#ai-provider').value); updateKeyStatus();};
  $('#save-ai-key').onclick = async () => {try {const key = $('#ai-key-input').value.trim(); if (!key) return toast('API 키를 입력하세요.'); keyStatus = await window.todoDesktop.aiKey($('#ai-provider').value,key); $('#ai-key-input').value = ''; updateKeyStatus(); toast('이 기기에 키를 저장했습니다.');} catch(error) {toast(error.message);}};
  $('#remove-ai-key').onclick = async () => {try {keyStatus = await window.todoDesktop.aiKey($('#ai-provider').value,''); updateKeyStatus(); toast('연결을 해제했습니다.');} catch(error) {toast(error.message);}};
  $('#ai-brief-button').onclick = async () => {
    const provider = $('#ai-provider').value;
    if (!keyStatus[provider]) {setView('connect'); toast('먼저 개인 API 키를 연결하세요.'); return;}
    const button = $('#ai-brief-button'); button.disabled = true; button.textContent = '정리하는 중…';
    try {$('#ai-result-text').textContent = await window.todoDesktop.aiBrief(provider,state.scope); $('#ai-result').showModal();}
    catch(error) {toast(error.message);}
    finally {button.disabled = false; button.textContent = '✳ AI에게 오늘의 순서 묻기';}
  };
  updateKeyStatus();
}
$('#close-ai-result').onclick = $('#done-ai-result').onclick = () => $('#ai-result').close();
$('#copy-ai-result').onclick = async () => {try {await navigator.clipboard.writeText($('#ai-result-text').textContent); toast('내용을 복사했습니다.');} catch {toast('복사할 수 없습니다.');}};
document.addEventListener('keydown', event => {if (event.key === 'Enter' && event.target.matches('.idea-card')) openEditor('idea',state.items.find(item => item.id === event.target.dataset.edit));});
document.addEventListener('keydown', event => {
  if (window.todoDesktop && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {event.preventDefault(); toggleCompact();}
  if (!desktopCompact && event.ctrlKey && event.key.toLowerCase() === 'n') {event.preventDefault(); openEditor();}
});
initializeDesktop().then(refresh).catch(error => toast(error.message));
setInterval(() => {if (!document.hidden) refresh();}, 20000);
