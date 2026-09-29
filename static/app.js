const $ = selector => document.querySelector(selector);
const state = {items: [], view: 'home', scope: 'all', taskFilter: 'open', editing: null, month: new Date(), selectedDay: localDate(new Date()), preferredDay: new Date().getDate()};
let desktopCompact = false;
let renderedDate = '';
let conflictAction = null;
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
  if (window.todoDesktop) {
    const result = await window.todoDesktop.api(path, options.method || 'GET', options.body ? JSON.parse(options.body) : null);
    if (!result.ok) {const error = new Error(result.error); error.status = result.status; throw error;}
    return result.data;
  }
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json();
  if (!response.ok) {const error = new Error(body.error || '요청에 실패했습니다.'); error.status = response.status; throw error;}
  return body;
}
async function refresh() {
  try {
    const items = await api('/api/items'), today = localDate(new Date());
    if (today === renderedDate && JSON.stringify(items) === JSON.stringify(state.items)) return;
    state.items = items; renderedDate = today; render();
    if ($('#search-dialog').open) renderSearch();
  }
  catch (error) { toast(error.message); }
}
function scoped(items) { return state.scope === 'all' ? items : items.filter(item => item.scope === state.scope); }
function openItems(items) { return items.filter(item => item.status !== 'done'); }
function row(item, showDate = true) {
  const complete = item.status === 'done';
  const meta = [scopeName[item.scope], kindName[item.kind], item.time || '', item.tags || ''].filter(Boolean);
  return `<div class="item-row ${complete ? 'is-done' : ''}"><button class="check-button ${complete ? 'done' : ''}" data-complete="${item.id}" aria-label="${complete ? '완료 취소' : '완료'}">${complete ? '✓' : ''}</button><div class="item-body" data-edit="${item.id}" role="button" tabindex="0" aria-label="${escapeHTML(item.title)} 수정"><div class="item-title">${escapeHTML(item.title)} ${item.priority === 'high' ? '<i class="priority-high" title="높은 우선순위"></i>' : ''}${item.kind === 'task' && item.status === 'doing' ? '<span class="status-chip">진행 중</span>' : ''}</div><div class="item-meta">${meta.map(text => `<span>${escapeHTML(text)}</span>`).join('<span>·</span>')}</div></div>${showDate && item.date ? `<span class="item-date">${formatDate(item.date)}</span>` : ''}</div>`;
}
function empty(message) { return `<div class="empty-state"><img class="empty-illustration" src="./empty.svg" alt="">${message}</div>`; }
function render() {
  const focused = document.activeElement;
  const focusType = focused?.dataset.edit ? 'edit' : focused?.dataset.complete ? 'complete' : focused?.dataset.compactEdit ? 'compact-edit' : null;
  const focusId = focusType && focused.dataset[focusType === 'compact-edit' ? 'compactEdit' : focusType];
  const focusArea = focused?.closest('.view, .compact-shell');
  const items = scoped(state.items), today = localDate(new Date());
  const dueToday = openItems(items.filter(item => item.date === today));
  const activeTasks = openItems(items.filter(item => item.kind === 'task'));
  const openIdeas = openItems(items.filter(item => item.kind === 'idea'));
  $('#today-label').textContent = new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  $('#greeting').textContent = '오늘도 하나씩,';
  $('#stat-today').textContent = dueToday.length;
  $('#stat-doing').textContent = items.filter(item => item.kind === 'task' && item.status === 'doing').length;
  $('#stat-ideas').textContent = openIdeas.length;
  $('#today-count').textContent = dueToday.length;
  const todayList = [...dueToday].sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  $('#today-list').innerHTML = todayList.length ? todayList.map(item => row(item, false)).join('') : empty('오늘 예정된 항목이 없어요.<br>새로운 하루를 계획해 보세요.');
  const overdue = openItems(items.filter(item => item.kind === 'task' && item.date && item.date < today)).sort((a,b) => b.date.localeCompare(a.date));
  $('#overdue-section').hidden = overdue.length === 0;
  $('#overdue-count').textContent = `${overdue.length}개`;
  $('#overdue-list').innerHTML = overdue.map(item => row(item)).join('');
  const upcoming = openItems(items.filter(item => item.date > today)).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0, 3);
  $('#upcoming-list').innerHTML = upcoming.length ? upcoming.map(item => row(item)).join('') : empty('다가오는 일정이 없어요.');
  renderTasks(items); renderIdeas(items); renderCalendar(items); renderCompact(items);
  if (focusId && !focused.isConnected) focusArea?.querySelector(`[data-${focusType}="${focusId}"]`)?.focus({preventScroll:true});
}
function renderCompact(items) {
  const today = localDate(new Date());
  const active = openItems(items.filter(item => item.kind === 'task' || item.kind === 'event'));
  const candidates = active.filter(item => !item.date || item.date <= today).sort((a,b) => {
    const rank = item => item.date && item.date < today ? 0 : item.date === today ? 1 : 2;
    return rank(a) - rank(b) || Number(b.status === 'doing') - Number(a.status === 'doing') || (a.time || '99:99').localeCompare(b.time || '99:99');
  });
  $('#compact-count').textContent = `${candidates.length}개 남음`;
  $('#compact-list').innerHTML = candidates.length ? candidates.slice(0,3).map(item => `<div class="compact-row"><button class="check-button" data-complete="${item.id}" aria-label="완료"></button><button class="compact-title" data-compact-edit="${item.id}">${escapeHTML(item.title)}</button>${item.time ? `<small>${escapeHTML(item.time)}</small>` : ''}</div>`).join('') : '<div class="compact-empty">오늘은 여유로운 페이지예요 ☀</div>';
}
function renderTasks(items) {
  let results = items.filter(item => item.kind === 'task');
  if (state.taskFilter === 'open') results = openItems(results);
  else if (state.taskFilter === 'doing') results = results.filter(item => item.status === 'doing');
  else if (state.taskFilter === 'done') results = results.filter(item => item.status === 'done');
  $('#task-total').textContent = `${results.length}개 항목`;
  const emptyText = state.taskFilter === 'doing' ? '지금 진행 중인 일이 없어요.<br>시작할 일을 골라보세요.' : state.taskFilter === 'done' ? '아직 완료한 일이 없어요.' : '아직 할 일이 없어요.<br>첫 번째 할 일을 추가해 보세요.';
  $('#tasks-list').innerHTML = results.length ? results.map(item => row(item)).join('') : empty(emptyText);
}
function renderIdeas(items) {
  const ideas = items.filter(item => item.kind === 'idea').sort((a,b) => b.created_at.localeCompare(a.created_at));
  $('#ideas-grid').innerHTML = ideas.length ? ideas.map(item => `<article class="idea-card" data-edit="${item.id}" role="button" tabindex="0" aria-label="${escapeHTML(item.title)} 수정"><div class="idea-card-top"><span>✦</span><small>${formatDate(item.created_at.slice(0,10))}</small></div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.details || '메모를 추가해 보세요.')}</p><div class="idea-card-footer">${scopeName[item.scope]} ${item.tags ? '· ' + escapeHTML(item.tags) : ''}</div></article>`).join('') : empty('아이디어를 자유롭게 기록해 보세요.<br>에이전트가 남긴 아이디어도 이곳에 모입니다.');
}
function renderSearch() {
  const focusedId = document.activeElement?.dataset.searchEdit;
  const query = $('#search-input').value.trim().toLocaleLowerCase();
  const rank = item => item.title.toLocaleLowerCase().startsWith(query) ? 0 : item.title.toLocaleLowerCase().includes(query) ? 1 : item.tags.toLocaleLowerCase().includes(query) ? 2 : 3;
  const matches = query
    ? state.items.filter(item => `${item.title} ${item.details} ${item.tags}`.toLocaleLowerCase().includes(query)).sort((a,b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at))
    : [...state.items].sort((a,b) => b.updated_at.localeCompare(a.updated_at)).slice(0,5);
  $('#search-count').textContent = query ? `${matches.length}개 결과${matches.length > 30 ? ' · 처음 30개 표시' : ''}` : '최근 기록';
  $('#search-results').innerHTML = matches.length ? matches.slice(0,30).map(item => {
    const preview = item.details?.replace(/\s+/g,' ').slice(0,120) || (item.date ? `${formatDate(item.date)} ${item.time || ''}` : '메모 없음');
    return `<button class="search-result" data-search-edit="${item.id}"><span>${kindName[item.kind]} · ${scopeName[item.scope]}${item.status === 'done' ? ' · 완료' : ''}${item.tags ? ` · ${escapeHTML(item.tags.slice(0,60))}` : ''}</span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(preview)}</small></button>`;
  }).join('') : `<div class="search-empty">${query ? '맞는 기록이 없어요. 다른 단어로 찾아보세요.' : '아직 기록이 없어요. 먼저 한 장 적어보세요.'}</div>`;
  if (focusedId) $('#search-results').querySelector(`[data-search-edit="${focusedId}"]`)?.focus({preventScroll:true});
}
async function openSearch() {
  if ($('#editor').open || $('#ai-result').open) return;
  if (desktopCompact) await toggleCompact(false);
  if (!$('#search-dialog').open) $('#search-dialog').showModal();
  renderSearch();
  $('#search-input').focus();
  $('#search-input').select();
}
function renderCalendar(items) {
  const month = state.month.getMonth(), year = state.month.getFullYear();
  $('#calendar-month').textContent = `${year}년 ${month+1}월`;
  const first = new Date(year, month, 1).getDay(), days = new Date(year, month+1, 0).getDate();
  const cells = Math.ceil((first+days)/7)*7;
  const dayFormat = new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'long'});
  const byDate = new Map();
  for (const item of items) if (item.date) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  $('#calendar-grid').innerHTML = Array.from({length:cells}, (_,index) => {
    const current = new Date(year, month, index-first+1), day = localDate(current);
    const matches = byDate.get(day) || [];
    const label = dayFormat.format(current);
    return `<button class="calendar-day ${current.getMonth() !== month ? 'outside' : ''} ${day === state.selectedDay ? 'selected' : ''} ${day === localDate(new Date()) ? 'today' : ''}" data-day="${day}" aria-label="${label}, ${matches.length}개 항목" aria-pressed="${day === state.selectedDay}"><span class="day-number">${current.getDate()}</span>${matches.slice(0,2).map(item => `<span class="calendar-dot ${item.kind === 'event' ? 'event' : ''}">${escapeHTML(item.title)}</span>`).join('')}${matches.length > 2 ? `<span class="calendar-more">+${matches.length-2}개 더</span>` : ''}</button>`;
  }).join('');
  const selected = new Date(`${state.selectedDay}T12:00:00`);
  $('#selected-day-title').textContent = new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(selected);
  const dayItems = [...(byDate.get(state.selectedDay) || [])].sort((a,b) => a.time.localeCompare(b.time));
  $('#selected-day-list').innerHTML = dayItems.length ? dayItems.map(item => row(item,false)).join('') : empty('이날의 일정이 없어요.');
}
function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `${view}-view`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-current').textContent = {home:'오늘',tasks:'할 일',calendar:'캘린더',ideas:'아이디어 보관함',connect:'에이전트 연결'}[view];
}
function setTaskFilter(filter) {
  state.taskFilter = filter;
  document.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('selected',el.dataset.filter === filter));
  render();
}
function syncStatusField() {
  const task = $('#editor-form').elements.kind.value === 'task';
  $('#task-status-field').hidden = !task;
  document.querySelectorAll('#task-status-field input').forEach(input => {input.disabled = !task;});
}
function openEditor(kind = 'task', item = null) {
  state.editing = item;
  const form = $('#editor-form'); form.reset();
  form.elements.kind.value = item?.kind || kind;
  form.elements.status.value = item?.status || 'todo';
  for (const key of ['title','details','date','time','scope','priority','tags']) if (item) form.elements[key].value = item[key] || '';
  syncStatusField();
  if (!item && kind === 'event') form.elements.date.value = state.selectedDay;
  if (!item && state.scope !== 'all') form.elements.scope.value = state.scope;
  $('#dialog-title').textContent = item ? '항목 수정' : '새 항목 만들기';
  $('#delete-button').hidden = !item;
  $('#editor').showModal();
  form.elements.title.focus();
}
function showConflict(action) {
  conflictAction = action;
  $('#conflict-force').textContent = action === 'delete' ? '변경된 기록 삭제하기' : '내 내용으로 덮어쓰기';
  $('#conflict-dialog').showModal();
}
document.addEventListener('click', async event => {
  const summary = event.target.closest('[data-summary]'); if (summary) {
    if (summary.dataset.summary === 'today') $('#today-list').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
    if (summary.dataset.summary === 'doing') {setView('tasks'); setTaskFilter('doing');}
    if (summary.dataset.summary === 'ideas') setView('ideas');
    return;
  }
  const view = event.target.closest('[data-view]'); if (view) return setView(view.dataset.view);
  const create = event.target.closest('[data-new]'); if (create) return openEditor(create.dataset.new);
  const scope = event.target.closest('[data-scope]'); if (scope) {state.scope = scope.dataset.scope; document.querySelectorAll('[data-scope]').forEach(el => el.classList.toggle('selected',el === scope)); return render();}
  const filter = event.target.closest('[data-filter]'); if (filter) return setTaskFilter(filter.dataset.filter);
  const day = event.target.closest('[data-day]'); if (day) {
    const selected = new Date(`${day.dataset.day}T12:00:00`);
    state.month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    state.selectedDay = day.dataset.day;
    state.preferredDay = selected.getDate();
    return render();
  }
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
    try {await api(`/api/items/${item.id}`,{method:'PATCH',body:JSON.stringify({status:item.status === 'done' ? 'todo' : 'done',expected_revision:item.revision})}); await refresh();}
    catch(error) {
      rowElement.classList.remove('completing');
      complete.classList.toggle('done', item.status === 'done'); complete.textContent = item.status === 'done' ? '✓' : '';
      if (error.status === 409) await refresh();
      toast(error.message);
    }
  }
});
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  try {
    const created = !state.editing;
    if (!created) data.expected_revision = state.editing.revision;
    const saved = await api(created ? '/api/items' : `/api/items/${state.editing.id}`,{method:created ? 'POST' : 'PATCH',body:JSON.stringify(data)});
    $('#editor').close(); await refresh();
    if (created && state.view === 'tasks' && saved.kind === 'task') {
      const visible = state.taskFilter === 'all' || (state.taskFilter === 'open' && saved.status !== 'done') || state.taskFilter === saved.status;
      if (!visible) setTaskFilter(saved.status === 'todo' ? 'open' : saved.status);
    }
    toast(created ? '기록했습니다.' : '수정했습니다.');
  } catch(error) {if (error.status === 409) showConflict('save'); else toast(error.message);}
});
document.querySelectorAll('#editor-form input[name="kind"]').forEach(input => {input.onchange = syncStatusField;});
$('#close-dialog').onclick = $('#cancel-button').onclick = () => $('#editor').close();
$('#delete-button').onclick = () => {if (!state.editing) return; $('#delete-item-title').textContent = state.editing.title; $('#delete-dialog').showModal();};
$('#cancel-delete').onclick = () => $('#delete-dialog').close();
$('#confirm-delete').onclick = async () => {
  const button = $('#confirm-delete'); button.disabled = true;
  try {await api(`/api/items/${state.editing.id}`,{method:'DELETE',body:JSON.stringify({expected_revision:state.editing.revision})}); $('#delete-dialog').close(); $('#editor').close(); toast('삭제했습니다.'); await refresh();}
  catch(error) {if (error.status === 409) {$('#delete-dialog').close(); showConflict('delete');} else toast(error.message);}
  finally {button.disabled = false;}
};
$('#conflict-keep').onclick = () => $('#conflict-dialog').close();
$('#conflict-reload').onclick = async () => {
  try {
    const items = await api('/api/items'), latest = items.find(item => item.id === state.editing.id);
    $('#conflict-dialog').close(); $('#editor').close();
    state.items = items; render();
    if (latest) openEditor(latest.kind, latest); else toast('기록이 다른 곳에서 삭제됐습니다.');
  } catch(error) {toast(error.message);}
};
$('#conflict-force').onclick = async () => {
  const button = $('#conflict-force'); button.disabled = true;
  try {
    const itemId = state.editing.id, deleting = conflictAction === 'delete';
    await api(`/api/items/${itemId}`,{method:deleting ? 'DELETE' : 'PATCH',body:deleting ? undefined : JSON.stringify(Object.fromEntries(new FormData($('#editor-form'))))});
    $('#conflict-dialog').close(); $('#editor').close(); await refresh();
    toast(deleting ? '삭제했습니다.' : '내 내용으로 저장했습니다.');
  } catch(error) {toast(error.message);}
  finally {button.disabled = false;}
};
function moveMonth(offset) {
  const target = new Date(state.month.getFullYear(), state.month.getMonth() + offset, 1);
  const day = Math.min(state.preferredDay, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  state.month = target;
  state.selectedDay = localDate(new Date(target.getFullYear(), target.getMonth(), day));
  render();
}
$('#prev-month').onclick = () => moveMonth(-1);
$('#next-month').onclick = () => moveMonth(1);
$('#go-today').onclick = () => {const today = new Date(); state.month = today; state.selectedDay = localDate(today); state.preferredDay = today.getDate(); render();};
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
$('#search-button').onclick = openSearch;
$('#close-search').onclick = () => $('#search-dialog').close();
$('#search-input').oninput = renderSearch;
$('#search-input').onkeydown = event => {
  if (event.key === 'Enter') {event.preventDefault(); $('#search-results .search-result')?.click();}
  if (event.key === 'ArrowDown') {event.preventDefault(); $('#search-results .search-result')?.focus();}
};
$('#search-results').onkeydown = event => {
  const result = event.target.closest('.search-result');
  if (!result || !['ArrowDown','ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'ArrowDown' ? result.nextElementSibling : result.previousElementSibling;
  (next?.matches('.search-result') ? next : event.key === 'ArrowUp' ? $('#search-input') : result).focus();
};
$('#search-results').onclick = event => {
  const button = event.target.closest('[data-search-edit]');
  if (!button) return;
  const item = state.items.find(entry => entry.id === button.dataset.searchEdit);
  $('#search-dialog').close();
  if (item) openEditor(item.kind, item);
};
$('#copy-command').onclick = async () => {try {await navigator.clipboard.writeText($('#mcp-command').textContent); toast('설정을 복사했습니다.');} catch {toast('복사할 수 없습니다. 내용을 직접 선택해 주세요.');}};
$('#export-button').onclick = async () => {
  try {if (window.todoDesktop) {if (await window.todoDesktop.export()) toast('백업을 저장했습니다.'); return;} const data = await api('/api/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const link = document.createElement('a'); link.href = url; link.download = `todotodo-backup-${localDate(new Date())}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);}
  catch(error) {toast(error.message);}
};
$('#import-button').onclick = async () => {
  if (!window.todoDesktop) return $('#import-file').click();
  try {
    const result = await window.todoDesktop.importBackup();
    if (result) {await refresh(); toast(`${result.imported}개 가져옴 · ${result.skipped}개 중복`);}
  } catch(error) {toast(error.message);}
};
$('#import-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('20MB 이하의 백업 파일만 가져올 수 있습니다.');
    const data = JSON.parse(await file.text());
    const result = await api('/api/import',{method:'POST',body:JSON.stringify(data)});
    await refresh(); toast(`${result.imported}개 가져옴 · ${result.skipped}개 중복`);
  } catch(error) {toast(error.message);}
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
document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-edit][role="button"]')) {
    event.preventDefault();
    openEditor('task',state.items.find(item => item.id === event.target.dataset.edit));
  }
});
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'k') {event.preventDefault(); openSearch();}
  if (window.todoDesktop && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {event.preventDefault(); toggleCompact();}
  if (!desktopCompact && event.ctrlKey && event.key.toLowerCase() === 'n') {event.preventDefault(); openEditor();}
});
initializeDesktop().then(refresh).catch(error => toast(error.message));
setInterval(() => {if (!document.hidden) refresh();}, 20000);
