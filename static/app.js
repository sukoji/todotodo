const $ = selector => document.querySelector(selector);
const state = {items: [], view: 'home', scope: 'all', taskFilter: 'open', calendarMode: 'month', editing: null, month: new Date(), selectedDay: localDate(new Date()), preferredDay: new Date().getDate()};
let desktopCompact = false;
let compactKind = 'task';
let renderedDate = '';
let conflictAction = null;
let editorBaseline = '';
let saving = false;
let compactSaving = false;
let pendingAppClose = false;
let pendingReminderId = null;
let editorDraftKind = 'task';
const editorDraftKey = 'todo-editor-drafts-v1';
const kindName = {task: '할 일', event: '일정', idea: '아이디어'};
const scopeName = {work: '업무', personal: '개인'};
const repeatName = {daily: '매일', weekly: '매주', monthly: '매월'};
$('#dialog-title').insertAdjacentHTML('afterend', '<p id="pending-reminder" class="pending-reminder" role="status" hidden></p>');

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
  return `${y === new Date().getFullYear() ? '' : `${y}년 `}${m}월 ${d}일`;
}
function formatTime(item) {return item.time ? (item.end_time ? `${item.time}–${item.end_time}` : item.time) : '';}
function toast(message, action) {
  const el = $('#toast');
  clearTimeout(toast.timer);
  el.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      await action.run();
    }, {once: true});
    el.append(button);
  }
  el.classList.add('show');
  toast.timer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 3000);
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
    if ($('#editor').open) renderEditorConflicts();
    if ($('#search-dialog').open) renderSearch();
  }
  catch (error) { toast(error.message); }
}
function scoped(items) { return state.scope === 'all' ? items : items.filter(item => item.scope === state.scope); }
function openItems(items) { return items.filter(item => item.status !== 'done'); }
function row(item, showDate = true, reschedule = false) {
  const complete = item.status === 'done';
  const meta = [scopeName[item.scope], kindName[item.kind], item.repeat ? `${repeatName[item.repeat]} 반복` : '', formatTime(item), item.tags || ''].filter(Boolean);
  return `<div class="item-row ${complete ? 'is-done' : ''}"><button class="check-button ${complete ? 'done' : ''}" data-complete="${item.id}" aria-label="${complete ? '완료 취소' : '완료'}">${complete ? '✓' : ''}</button><div class="item-body" data-edit="${item.id}" role="button" tabindex="0" aria-label="${escapeHTML(item.title)} 수정"><div class="item-title">${escapeHTML(item.title)} ${item.priority === 'high' ? '<i class="priority-high" title="높은 우선순위"></i>' : ''}${item.kind === 'task' && item.status === 'doing' ? '<span class="status-chip">진행 중</span>' : ''}</div><div class="item-meta">${meta.map(text => `<span>${escapeHTML(text)}</span>`).join('<span>·</span>')}</div></div>${showDate && item.date ? `<span class="item-date">${formatDate(item.date)}</span>` : ''}${reschedule ? `<button class="reschedule-button" data-reschedule="${item.id}" aria-label="${escapeHTML(item.title)} 오늘로 옮기기">오늘로 ↗</button>` : ''}</div>`;
}
function empty(message) { return `<div class="empty-state"><img class="empty-illustration" src="./empty.svg" alt="">${message}</div>`; }
function render() {
  const focused = document.activeElement;
  const focusType = focused?.dataset.edit ? 'edit' : focused?.dataset.complete ? 'complete' : focused?.dataset.compactEdit ? 'compact-edit' : focused?.dataset.day === state.selectedDay ? 'day' : null;
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
  $('#overdue-list').innerHTML = overdue.map(item => row(item, true, true)).join('');
  const upcoming = openItems(items.filter(item => item.date > today)).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0, 3);
  $('#upcoming-list').innerHTML = upcoming.length ? upcoming.map(item => row(item)).join('') : empty('다가오는 일정이 없어요.');
  renderTasks(items); renderIdeas(items); renderCalendar(items); renderCompact(state.items);
  if (focusId && !focused.isConnected) focusArea?.querySelector(`[data-${focusType}="${focusId}"]`)?.focus({preventScroll:true});
}
function renderCompact(items) {
  const today = localDate(new Date());
  const visible = items.filter(item => item.scope === $('#compact-scope').value);
  const list = $('#compact-list'), scrollTop = list.scrollTop;
  if (compactKind === 'idea') {
    const ideas = openItems(visible.filter(item => item.kind === 'idea')).sort((a,b) => b.updated_at.localeCompare(a.updated_at));
    const recent = ideas.slice(0, 30);
    $('.compact-caption strong').textContent = '최근 아이디어';
    $('#compact-count').textContent = ideas.length > 30 ? '최근 30개' : `${ideas.length}개 메모`;
    list.innerHTML = recent.length ? recent.map(item => `<div class="compact-row compact-idea-row"><span class="compact-idea-mark" aria-hidden="true">✦</span><button class="compact-title" data-compact-edit="${item.id}"><strong>${escapeHTML(item.title)}</strong>${item.details ? `<small>${escapeHTML(item.details.trim().slice(0, 60))}</small>` : ''}</button></div>`).join('') : '<div class="compact-empty">떠오른 생각을 한 줄 적어보세요 ✦</div>';
    list.scrollTop = scrollTop;
    return;
  }
  $('.compact-caption strong').textContent = '오늘의 작은 메모';
  const active = openItems(visible.filter(item => item.kind === 'task' || item.kind === 'event'));
  const candidates = active.filter(item => !item.date || item.date <= today).sort((a,b) => {
    const rank = item => item.date && item.date < today ? 0 : item.date === today ? 1 : 2;
    return rank(a) - rank(b) || Number(b.status === 'doing') - Number(a.status === 'doing') || (a.time || '99:99').localeCompare(b.time || '99:99');
  });
  $('#compact-count').textContent = `${candidates.length}개 남음`;
  list.innerHTML = candidates.length ? candidates.map(item => `<div class="compact-row"><button class="check-button" data-complete="${item.id}" aria-label="완료"></button><button class="compact-title" data-compact-edit="${item.id}">${escapeHTML(item.title)}</button><small>${scopeName[item.scope]}${item.time ? ` · ${escapeHTML(item.time)}` : ''}</small></div>`).join('') : '<div class="compact-empty">오늘은 여유로운 페이지예요 ☀</div>';
  list.scrollTop = scrollTop;
}
function renderTasks(items) {
  let results = items.filter(item => item.kind === 'task');
  if (state.taskFilter === 'open') results = openItems(results);
  else if (state.taskFilter === 'doing') results = results.filter(item => item.status === 'doing');
  else if (state.taskFilter === 'done') results = results.filter(item => item.status === 'done');
  $('#task-total').textContent = `${results.length}개 항목`;
  const emptyText = state.taskFilter === 'doing' ? '지금 진행 중인 일이 없어요.<br>시작할 일을 골라보세요.' : state.taskFilter === 'done' ? '아직 완료한 일이 없어요.' : '아직 할 일이 없어요.<br>첫 번째 할 일을 추가해 보세요.';
  if (!results.length) {$('#tasks-list').innerHTML = empty(emptyText); return;}
  if (state.taskFilter === 'done') {
    $('#tasks-list').innerHTML = results.sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(item => row(item)).join('');
    return;
  }
  const today = localDate(new Date()), active = openItems(results);
  const byTime = (a,b) => (a.time || '99:99').localeCompare(b.time || '99:99');
  const groups = [
    ['오늘', active.filter(item => item.date === today).sort(byTime)],
    ['지난 날짜', active.filter(item => item.date && item.date < today).sort((a,b) => b.date.localeCompare(a.date) || byTime(a,b))],
    ['다가오는 날', active.filter(item => item.date > today).sort((a,b) => a.date.localeCompare(b.date) || byTime(a,b))],
    ['날짜 없음', active.filter(item => !item.date).sort((a,b) => Number(b.status === 'doing') - Number(a.status === 'doing') || Number(b.priority === 'high') - Number(a.priority === 'high') || b.created_at.localeCompare(a.created_at))]
  ];
  if (state.taskFilter === 'all') groups.push(['완료', results.filter(item => item.status === 'done').sort((a,b) => b.updated_at.localeCompare(a.updated_at))]);
  $('#tasks-list').innerHTML = groups.filter(([,entries]) => entries.length).map(([label,entries]) => `<h2 class="task-group-heading">${label}<span>${entries.length}개</span></h2>${entries.map(item => row(item, true, item.status !== 'done' && item.date && item.date < today)).join('')}`).join('');
}
function renderIdeas(items) {
  const ideas = items.filter(item => item.kind === 'idea').sort((a,b) => b.created_at.localeCompare(a.created_at));
  $('#ideas-grid').innerHTML = ideas.length ? ideas.map(item => `<article class="idea-card" data-edit="${item.id}" role="button" tabindex="0" aria-label="${escapeHTML(item.title)} 수정"><div class="idea-card-top"><span>✦</span><small>${formatDate(item.created_at.slice(0,10))}</small></div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.details || '메모를 추가해 보세요.')}</p><div class="idea-card-footer">${scopeName[item.scope]} ${item.tags ? '· ' + escapeHTML(item.tags) : ''}</div></article>`).join('') : empty('아이디어를 자유롭게 기록해 보세요.<br>에이전트가 남긴 아이디어도 이곳에 모입니다.');
}
function renderSearch() {
  const focusedId = document.activeElement?.dataset.searchEdit;
  const query = $('#search-input').value.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const rank = item => {
    const title = item.title.toLocaleLowerCase();
    if (title.startsWith(query)) return 0;
    if (terms.every(term => title.includes(term))) return 1;
    if (terms.some(term => title.includes(term))) return 2;
    return terms.some(term => (item.tags || '').toLocaleLowerCase().includes(term)) ? 3 : 4;
  };
  const matches = query
    ? state.items.filter(item => {
      const text = `${item.title} ${item.details || ''} ${item.tags || ''} ${item.date || ''} ${formatDate(item.date)} ${formatTime(item)} ${kindName[item.kind]} ${scopeName[item.scope]}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }).sort((a,b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at))
    : [...state.items].sort((a,b) => b.updated_at.localeCompare(a.updated_at)).slice(0,5);
  $('#search-count').textContent = query ? `${matches.length}개 결과${matches.length > 30 ? ' · 처음 30개 표시' : ''}` : '최근 기록';
  $('#search-results').innerHTML = matches.length ? matches.slice(0,30).map(item => {
    const details = item.details?.replace(/\s+/g,' ') || '';
    const matchAt = terms.map(term => details.toLocaleLowerCase().indexOf(term)).filter(index => index >= 0).sort((a,b) => a - b)[0];
    const start = matchAt > 45 ? matchAt - 40 : 0;
    const preview = details ? `${start ? '…' : ''}${details.slice(start,start+120)}${start+120 < details.length ? '…' : ''}` : (item.date ? `${formatDate(item.date)} ${formatTime(item)}` : '메모 없음');
    return `<button class="search-result" data-search-edit="${item.id}"><span>${kindName[item.kind]} · ${scopeName[item.scope]}${item.status === 'done' ? ' · 완료' : ''}${item.date ? ` · ${formatDate(item.date)}${item.time ? ` ${escapeHTML(formatTime(item))}` : ''}` : ''}${item.tags ? ` · ${escapeHTML(item.tags.slice(0,60))}` : ''}</span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(preview)}</small></button>`;
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
  const week = state.calendarMode === 'week';
  const first = new Date(year, month, 1).getDay(), days = new Date(year, month+1, 0).getDate();
  const cells = week ? 7 : Math.ceil((first+days)/7)*7;
  const start = week ? new Date(`${state.selectedDay}T12:00:00`) : new Date(year, month, 1-first);
  if (week) start.setDate(start.getDate() - start.getDay());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate()+6);
  $('#calendar-month').textContent = week ? `${formatDate(localDate(start))} – ${formatDate(localDate(end))}` : `${year}년 ${month+1}월`;
  $('#calendar-view .eyebrow').textContent = week ? '한 주를 펼쳐서' : '한 달을 한눈에';
  $('#prev-month').setAttribute('aria-label', week ? '이전 주' : '이전 달');
  $('#next-month').setAttribute('aria-label', week ? '다음 주' : '다음 달');
  document.querySelectorAll('[data-calendar-mode]').forEach(button => {
    const selected = button.dataset.calendarMode === state.calendarMode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#calendar-grid').classList.toggle('week', week);
  $('.calendar-layout').classList.toggle('week', week);
  const dayFormat = new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'long'});
  const byDate = new Map();
  for (const item of items) if (item.date) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  const conflictDays = new Set([...byDate].filter(([, entries]) => timeConflictPairs(entries).length).map(([day]) => day));
  $('#calendar-grid').innerHTML = Array.from({length:cells}, (_,index) => {
    const current = new Date(start.getFullYear(), start.getMonth(), start.getDate()+index), day = localDate(current);
    const matches = byDate.get(day) || [];
    const label = dayFormat.format(current);
    return `<button class="calendar-day ${!week && current.getMonth() !== month ? 'outside' : ''} ${day === state.selectedDay ? 'selected' : ''} ${day === localDate(new Date()) ? 'today' : ''} ${conflictDays.has(day) ? 'has-time-conflict' : ''}" data-day="${day}" tabindex="${day === state.selectedDay ? 0 : -1}" aria-label="${label}, ${matches.length}개 항목${conflictDays.has(day) ? ', 시간 겹침' : ''}" aria-pressed="${day === state.selectedDay}"><span class="day-number">${current.getDate()}</span>${matches.slice(0,2).map(item => `<span class="calendar-dot ${item.kind === 'event' ? 'event' : ''}">${week && item.time ? `<strong class="calendar-time">${escapeHTML(formatTime(item))}</strong>` : ''}${escapeHTML(item.title)}</span>`).join('')}${matches.length > 2 ? `<span class="calendar-more">+${matches.length-2}개 더</span>` : ''}</button>`;
  }).join('');
  const selected = new Date(`${state.selectedDay}T12:00:00`);
  $('#selected-day-title').textContent = new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(selected);
  const dayItems = [...(byDate.get(state.selectedDay) || [])].sort((a,b) => a.time.localeCompare(b.time));
  const conflicts = timeConflictPairs(dayItems);
  $('#calendar-conflicts').hidden = !conflicts.length;
  $('#calendar-conflicts').innerHTML = conflicts.length ? `<strong>시간이 겹쳐요</strong><span>${conflicts.slice(0,2).map(([a,b]) => `${escapeHTML(a.title)} · ${escapeHTML(formatTime(a))} ↔ ${escapeHTML(b.title)} · ${escapeHTML(formatTime(b))}`).join('<br>')}${conflicts.length > 2 ? `<br>외 ${conflicts.length-2}쌍` : ''}</span>` : '';
  const timed = dayItems.filter(item => item.kind !== 'idea' && item.time);
  const untimed = dayItems.filter(item => item.kind === 'idea' || !item.time);
  const timeline = $('#day-timeline');
  timeline.hidden = !timed.length;
  if (timed.length) {
    const minutes = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3,5));
    const first = Math.min(...timed.map(item => minutes(item.time)));
    const last = Math.max(...timed.map(item => item.end_time && item.end_time > item.time ? minutes(item.end_time) : minutes(item.time) + 30));
    let from = Math.max(0, Math.floor(first / 60) * 60 - 60);
    let until = Math.min(1440, Math.ceil(last / 60) * 60 + 60);
    if (until - from < 180) {until = Math.min(1440, from + 180); from = Math.max(0, until - 180);}
    const clock = value => `${String(Math.floor(value / 60)).padStart(2,'0')}:00`;
    timeline.innerHTML = `<div class="timeline-heading"><strong>이날의 시간표</strong><span>${timed.length}개</span></div><div class="timeline-scale"><span>${clock(from)}</span><span>${clock(until)}</span></div>${timed.map(item => `<div class="timeline-entry ${item.status === 'done' ? 'is-done' : ''}">${row(item,false)}<div class="timeline-track" aria-hidden="true"><span class="timeline-fill ${item.kind === 'event' ? 'event' : 'task'} ${item.end_time && item.end_time > item.time ? '' : 'point'}" data-timeline-id="${item.id}"></span></div></div>`).join('')}`;
    for (const item of timed) {
      const fill = timeline.querySelector(`[data-timeline-id="${item.id}"]`);
      fill.style.left = `${(minutes(item.time) - from) / (until - from) * 100}%`;
      if (item.end_time && item.end_time > item.time) fill.style.width = `${(minutes(item.end_time) - minutes(item.time)) / (until - from) * 100}%`;
    }
  }
  $('#selected-day-list').hidden = timed.length && !untimed.length;
  $('#selected-day-list').innerHTML = untimed.length ? `${timed.length ? '<h3 class="timeline-untimed">시간 미정</h3>' : ''}${untimed.map(item => row(item,false)).join('')}` : timed.length ? '' : empty('이날의 일정이 없어요.');
}
function selectCalendarDay(day) {
  const selected = new Date(`${day}T12:00:00`);
  state.month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  state.selectedDay = day;
  state.preferredDay = selected.getDate();
  renderCalendar(scoped(state.items));
  $('#calendar-grid .calendar-day.selected')?.focus();
}
function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `${view}-view`));
  document.querySelectorAll('.nav-item, .settings-link').forEach(el => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  $('#breadcrumb-current').textContent = {home:'오늘',tasks:'할 일',calendar:'캘린더',ideas:'아이디어 보관함',connect:'에이전트 연결'}[view];
  window.scrollTo(0, 0);
}
function setTaskFilter(filter) {
  state.taskFilter = filter;
  document.querySelectorAll('[data-filter]').forEach(el => {const selected = el.dataset.filter === filter; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', String(selected));});
  render();
}
function syncStatusField() {
  const form = $('#editor-form'), task = form.elements.kind.value === 'task';
  (form.elements.kind.value === 'idea' ? form.elements.details : form.elements.title).closest('.field').after($('#schedule-fields'));
  $('#task-status-field').hidden = !task;
  document.querySelectorAll('#task-status-field input').forEach(input => {input.disabled = !task;});
}
function syncRepeatField(fillDefault = false) {
  const form = $('#editor-form'), kind = form.elements.kind.value;
  const series = Boolean(state.editing?.series_id), idea = kind === 'idea';
  const repeat = form.elements.repeat, until = form.elements.repeat_until;
  if (idea) {repeat.value = ''; until.value = '';}
  if (fillDefault && repeat.value && !until.value && form.elements.date.value) {
    const next = new Date(`${form.elements.date.value}T12:00:00`);
    next.setFullYear(next.getFullYear() + 1);
    until.value = localDate(next);
  }
  $('#repeat-fields').hidden = idea;
  $('#repeat-until-field').hidden = idea || !repeat.value;
  repeat.disabled = idea || series;
  until.disabled = idea || series || !repeat.value;
  until.required = !idea && !series && Boolean(repeat.value);
  until.min = form.elements.date.value || '';
  $('#repeat-note').hidden = !series && !repeat.value;
  $('#repeat-note').textContent = series
    ? `이 날짜만 수정됩니다. ${repeatName[state.editing.repeat]} 반복은 ${formatDate(state.editing.repeat_until)}까지 만들었어요.`
    : repeat.value ? `종료 날짜까지 날짜별 기록을 만듭니다. 각 날짜는 따로 완료·수정할 수 있어요.${repeat.value === 'monthly' ? ' 없는 날짜는 그 달의 말일에 놓습니다.' : ''} 최대 1,000개까지 만들 수 있습니다.` : '';
}
function shortcutDate(key) {
  if (key === 'clear') return '';
  const day = new Date();
  if (key === 'tomorrow') day.setDate(day.getDate() + 1);
  return localDate(day);
}
function syncDateShortcuts() {
  const value = $('#editor-form').elements.date.value;
  document.querySelectorAll('[data-date-shortcut]').forEach(button => button.setAttribute('aria-pressed', String(value === shortcutDate(button.dataset.dateShortcut))));
}
function renderEditorConflicts() {
  const form = $('#editor-form');
  const candidate = {...Object.fromEntries(new FormData(form)), id: state.editing?.id || ''};
  const matches = state.items.filter(item => timeOverlaps(candidate, item));
  const notice = $('#editor-time-conflicts');
  const wasHidden = notice.hidden;
  notice.hidden = !matches.length;
  notice.textContent = matches.length ? `시간이 겹쳐요: ${matches.slice(0,2).map(item => `${item.title} (${formatTime(item)})`).join(', ')}${matches.length > 2 ? ` 외 ${matches.length-2}개` : ''} · 겹쳐도 저장할 수 있어요.` : '';
  if (matches.length && wasHidden && $('#editor').open) notice.scrollIntoView({block:'nearest', behavior:'smooth'});
}
function editorDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(editorDraftKey));
    return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  }
  catch {return {};}
}
function saveEditorDraft() {
  if (state.editing || !$('#editor').open) return;
  const form = $('#editor-form'), kind = form.elements.kind.value;
  const drafts = editorDrafts();
  const draft = Object.fromEntries(new FormData(form));
  draft.status = form.elements.status.value;
  const defaultScope = state.scope === 'all' ? 'personal' : state.scope;
  if (![draft.title, draft.details, draft.tags, draft.time, draft.end_time].some(value => value?.trim()) &&
      (!draft.date || (kind === 'event' && draft.date === state.selectedDay)) &&
      !draft.repeat && draft.scope === defaultScope && draft.priority === 'normal' && draft.status === 'todo') {
    clearEditorDraft(kind);
    return;
  }
  drafts[kind] = draft;
  localStorage.setItem(editorDraftKey, JSON.stringify(drafts));
  editorDraftKind = kind;
}
function clearEditorDraft(kind) {
  const drafts = editorDrafts();
  delete drafts[kind];
  if (Object.keys(drafts).length) localStorage.setItem(editorDraftKey, JSON.stringify(drafts));
  else localStorage.removeItem(editorDraftKey);
}
function restoreEditorDraft(kind) {
  const draft = editorDrafts()[kind];
  if (draft && typeof draft === 'object') {
    const form = $('#editor-form');
    for (const key of ['title','details','date','time','end_time','repeat','repeat_until','scope','priority','status','tags']) {
      if (typeof draft[key] === 'string') form.elements[key].value = draft[key];
    }
  }
  $('#editor-draft-notice').hidden = !draft;
  return Boolean(draft);
}
function openEditor(kind = 'task', item = null) {
  state.editing = item;
  const form = $('#editor-form'); form.reset();
  for (const key of ['date','time','end_time','repeat_until']) form.elements[key].setCustomValidity('');
  form.elements.kind.value = item?.kind || kind;
  form.querySelector('[name="kind"][value="idea"]').disabled = Boolean(item?.series_id);
  form.elements.status.value = item?.status || 'todo';
  for (const key of ['title','details','date','time','end_time','repeat','repeat_until','scope','priority','tags']) if (item) form.elements[key].value = item[key] || '';
  syncStatusField();
  if (!item && kind === 'event') form.elements.date.value = state.selectedDay;
  if (!item && state.scope !== 'all') form.elements.scope.value = state.scope;
  editorDraftKind = form.elements.kind.value;
  $('#editor-draft-notice').hidden = Boolean(item);
  if (!item) restoreEditorDraft(editorDraftKind);
  syncRepeatField();
  syncDateShortcuts();
  renderEditorConflicts();
  $('#dialog-title').textContent = item ? '항목 수정' : '새 항목 만들기';
  $('#delete-button').hidden = !item;
  editorBaseline = JSON.stringify([...new FormData(form)]);
  $('#editor').showModal();
  $('#pending-reminder').hidden = !pendingReminderId;
  form.elements.title.focus();
  if (!$('#editor-time-conflicts').hidden) $('#editor-time-conflicts').scrollIntoView({block:'nearest'});
}
async function openReminderItem(itemId) {
  try {
    const items = await api('/api/items');
    state.items = items; renderedDate = localDate(new Date()); render();
    const item = items.find(entry => entry.id === itemId);
    if (!item) {toast('알림의 기록을 찾을 수 없어요'); return;}
    if ($('#editor').open && editorHasChanges()) {
      pendingReminderId = itemId;
      $('#pending-reminder').textContent = `${item.title} · 편집을 마치면 열어요`;
      $('#pending-reminder').hidden = false;
      return;
    }
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    state.scope = item.scope;
    document.querySelectorAll('[data-scope]').forEach(el => {const selected = el.dataset.scope === item.scope; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', String(selected));});
    render();
    if (item.kind === 'event') {setView('calendar'); if (item.date) selectCalendarDay(item.date);}
    else if (item.kind === 'task') {setView('tasks'); setTaskFilter('all');}
    else setView('ideas');
    openEditor(item.kind, item);
  } catch(error) {toast(error.message);}
}
function requestCloseEditor() {
  if (saving) {toast('저장 중입니다.'); return;}
  if (editorHasChanges()) $('#discard-dialog').showModal();
  else $('#editor').close();
}
function editorHasChanges() {
  return $('#editor').open && JSON.stringify([...new FormData($('#editor-form'))]) !== editorBaseline;
}
function confirmCloseApp() {
  window.todoDesktop.windowControl('confirm-close').catch(error => toast(error.message));
}
function requestCloseApp() {
  if (saving || compactSaving) {toast('저장 중입니다.'); return;}
  if ($('#discard-dialog').open) {pendingAppClose = true; return;}
  if (editorHasChanges()) {
    pendingAppClose = true;
    $('#discard-dialog').showModal();
  } else confirmCloseApp();
}
function showConflict(action) {
  conflictAction = action;
  $('#conflict-force').textContent = action === 'delete-future' ? '이후 반복 삭제하기' : action === 'delete' ? '변경된 기록 삭제하기' : '내 내용으로 덮어쓰기';
  $('#conflict-dialog').showModal();
}
document.addEventListener('click', async event => {
  document.querySelectorAll('.window-menu[open]').forEach(menu => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  const summary = event.target.closest('[data-summary]'); if (summary) {
    if (summary.dataset.summary === 'today') $('#today-list').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
    if (summary.dataset.summary === 'doing') {setView('tasks'); setTaskFilter('doing');}
    if (summary.dataset.summary === 'ideas') setView('ideas');
    return;
  }
  const view = event.target.closest('[data-view]'); if (view) return setView(view.dataset.view);
  const create = event.target.closest('[data-new]'); if (create) return openEditor(create.dataset.new);
  const scope = event.target.closest('[data-scope]'); if (scope) {state.scope = scope.dataset.scope; if (state.scope !== 'all') {$('#compact-scope').value = state.scope; syncCompactDraftIndicator();} document.querySelectorAll('[data-scope]').forEach(el => {const selected = el === scope; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', String(selected));}); return render();}
  const filter = event.target.closest('[data-filter]'); if (filter) return setTaskFilter(filter.dataset.filter);
  const day = event.target.closest('[data-day]'); if (day) return selectCalendarDay(day.dataset.day);
  const compactEdit = event.target.closest('[data-compact-edit]'); if (compactEdit) {
    const item = state.items.find(entry => entry.id === compactEdit.dataset.compactEdit);
    await toggleCompact(false); setTimeout(() => openEditor(item.kind,item), 300); return;
  }
  const reschedule = event.target.closest('[data-reschedule]'); if (reschedule) {
    const item = state.items.find(entry => entry.id === reschedule.dataset.reschedule);
    reschedule.disabled = true;
    try {
      const saved = await api(`/api/items/${item.id}`, {method:'PATCH', body:JSON.stringify({date:localDate(new Date()), expected_revision:item.revision})});
      await refresh();
      document.querySelector(`.view.active [data-edit="${item.id}"]`)?.focus({preventScroll:true});
      toast('오늘로 옮겼어요', {label:'되돌리기', run: async () => {
        try {
          await api(`/api/items/${item.id}`, {method:'PATCH', body:JSON.stringify({date:item.date, expected_revision:saved.revision})});
          await refresh();
          document.querySelector(`.view.active [data-reschedule="${item.id}"]`)?.focus({preventScroll:true});
          toast('원래 날짜로 돌렸어요');
        } catch(error) {
          if (error.status === 409) await refresh();
          toast(error.status === 409 ? '다른 곳에서 바뀌어 되돌릴 수 없어요' : error.message);
        }
      }});
    } catch(error) {
      reschedule.disabled = false;
      if (error.status === 409) await refresh();
      toast(error.message);
    }
    return;
  }
  const edit = event.target.closest('[data-edit]'); if (edit) return openEditor('task',state.items.find(item => item.id === edit.dataset.edit));
  const complete = event.target.closest('[data-complete]'); if (complete) {
    const item = state.items.find(entry => entry.id === complete.dataset.complete);
    const rowElement = complete.closest('.item-row, .compact-row');
    complete.disabled = true;
    if (item.status !== 'done' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      complete.classList.add('done'); complete.textContent = '✓';
      rowElement.classList.add('completing');
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    try {
      const saved = await api(`/api/items/${item.id}`,{method:'PATCH',body:JSON.stringify({status:item.status === 'done' ? 'todo' : 'done',expected_revision:item.revision})});
      await refresh();
      if (item.status !== 'done') toast('완료했어요', {label: '되돌리기', run: async () => {
        try {
          await api(`/api/items/${item.id}`, {method:'PATCH', body:JSON.stringify({status:item.status, expected_revision:saved.revision})});
          await refresh();
          toast('다시 할 일에 넣었어요');
        } catch (error) {
          if (error.status === 409) await refresh();
          toast(error.status === 409 ? '다른 곳에서 바뀌어 되돌릴 수 없어요' : error.message);
        }
      }});
    }
    catch(error) {
      rowElement.classList.remove('completing');
      complete.classList.toggle('done', item.status === 'done'); complete.textContent = item.status === 'done' ? '✓' : '';
      complete.disabled = false;
      if (error.status === 409) await refresh();
      toast(error.message);
    }
  }
});
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  if (data.time && !data.date) {
    form.elements.date.setCustomValidity('시간을 입력하려면 날짜를 먼저 선택하세요.');
    form.elements.date.reportValidity();
    return;
  }
  if (data.end_time && !data.time) {
    form.elements.time.setCustomValidity('종료 시간을 입력하려면 시작 시간을 먼저 선택하세요.');
    form.elements.time.reportValidity();
    return;
  }
  if (data.end_time && data.end_time <= data.time) {
    form.elements.end_time.setCustomValidity('종료 시간은 시작 시간보다 늦어야 합니다.');
    form.elements.end_time.reportValidity();
    return;
  }
  if (data.repeat && !data.date) {
    form.elements.date.setCustomValidity('반복하려면 시작 날짜를 선택하세요.');
    form.elements.date.reportValidity();
    return;
  }
  if (data.repeat && data.repeat_until < data.date) {
    form.elements.repeat_until.setCustomValidity('반복 종료 날짜는 시작 날짜보다 이르지 않아야 합니다.');
    form.elements.repeat_until.reportValidity();
    return;
  }
  saving = true;
  const saveButton = form.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  try {
    const created = !state.editing;
    if (!created) data.expected_revision = state.editing.revision;
    const saved = await api(created ? '/api/items' : `/api/items/${state.editing.id}`,{method:created ? 'POST' : 'PATCH',body:JSON.stringify(data)});
    if (created) clearEditorDraft(form.elements.kind.value);
    $('#editor').close(); await refresh();
    if (created && state.view === 'tasks' && saved.kind === 'task') {
      const visible = state.taskFilter === 'all' || (state.taskFilter === 'open' && saved.status !== 'done') || state.taskFilter === saved.status;
      if (!visible) setTaskFilter(saved.status === 'todo' ? 'open' : saved.status);
    }
    const repeated = data.repeat && saved.series_id ? state.items.filter(item => item.series_id === saved.series_id).length : 0;
    toast(repeated ? `${repeated}개 날짜에 반복 기록을 만들었어요.` : created ? '기록했습니다.' : '수정했습니다.');
  } catch(error) {if (error.status === 409) showConflict('save'); else toast(error.message);}
  finally {saving = false; saveButton.disabled = false;}
});
document.querySelectorAll('#editor-form input[name="kind"]').forEach(input => {input.onchange = () => {
  if (!state.editing && editorDraftKind !== input.value) {
    editorDraftKind = input.value;
    restoreEditorDraft(input.value);
  }
  syncStatusField(); syncRepeatField(); syncDateShortcuts(); renderEditorConflicts();
  saveEditorDraft();
};});
document.querySelectorAll('[data-date-shortcut]').forEach(button => {
  button.onclick = () => {const form = $('#editor-form'), date = form.elements.date; date.value = shortcutDate(button.dataset.dateShortcut); date.setCustomValidity(''); if (!date.value) {form.elements.time.value = ''; form.elements.end_time.value = '';} syncDateShortcuts(); syncRepeatField(); renderEditorConflicts(); saveEditorDraft();};
});
$('#editor-form').elements.repeat.onchange = () => {
  const form = $('#editor-form');
  if (!form.elements.repeat.value) form.elements.repeat_until.value = '';
  syncRepeatField(true); saveEditorDraft();
};
$('#editor-form').addEventListener('input', event => {if (event.target.matches('[name="date"], [name="time"], [name="end_time"], [name="status"]')) renderEditorConflicts();});
$('#editor-form').addEventListener('input', event => {if (event.target.name !== 'kind') queueMicrotask(saveEditorDraft);});
$('#editor-form').addEventListener('change', event => {if (event.target.tagName === 'SELECT') saveEditorDraft();});
$('#clear-editor-draft').onclick = () => {
  const kind = $('#editor-form').elements.kind.value;
  clearEditorDraft(kind);
  const form = $('#editor-form'); form.reset(); form.elements.kind.value = kind;
  for (const key of ['date','time','end_time','repeat_until']) form.elements[key].setCustomValidity('');
  if (kind === 'event') form.elements.date.value = state.selectedDay;
  if (state.scope !== 'all') form.elements.scope.value = state.scope;
  $('#editor-draft-notice').hidden = true;
  syncStatusField(); syncRepeatField(); syncDateShortcuts(); renderEditorConflicts();
  editorBaseline = JSON.stringify([...new FormData(form)]);
  form.elements.title.focus();
};
$('#editor-form').elements.date.oninput = event => {event.target.setCustomValidity(''); if (!event.target.value) {$('#editor-form').elements.time.value = ''; $('#editor-form').elements.end_time.value = '';} syncDateShortcuts(); syncRepeatField();};
$('#editor-form').elements.time.oninput = event => {event.target.setCustomValidity(''); if (!event.target.value) $('#editor-form').elements.end_time.value = ''; $('#editor-form').elements.end_time.setCustomValidity('');};
$('#editor-form').elements.end_time.oninput = event => event.target.setCustomValidity('');
$('#editor-form').elements.repeat_until.oninput = event => event.target.setCustomValidity('');
$('#close-dialog').onclick = $('#cancel-button').onclick = requestCloseEditor;
$('#editor').setAttribute('closedby', 'none');
new MutationObserver(() => {
  if (!pendingReminderId || $('#editor').open) return;
  const itemId = pendingReminderId;
  pendingReminderId = null;
  $('#pending-reminder').hidden = true;
  openReminderItem(itemId);
}).observe($('#editor'), {attributes:true, attributeFilter:['open']});
$('#editor').addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  requestCloseEditor();
});
$('#keep-editing').onclick = () => {pendingAppClose = false; $('#discard-dialog').close();};
$('#discard-dialog').addEventListener('cancel', () => {pendingAppClose = false;});
$('#discard-editing').onclick = () => {
  const closeApp = pendingAppClose;
  pendingAppClose = false;
  if (closeApp) {pendingReminderId = null; $('#pending-reminder').hidden = true;}
  if (!state.editing) clearEditorDraft($('#editor-form').elements.kind.value);
  $('#discard-dialog').close();
  if ($('#editor').open) $('#editor').close();
  if (closeApp) confirmCloseApp();
};
$('#delete-button').onclick = () => {
  if (!state.editing) return;
  if (saving) {toast('저장 중입니다.'); return;}
  const item = state.editing;
  const future = item.series_id ? state.items.filter(entry => entry.series_id === item.series_id && entry.date >= item.date).length : 0;
  $('#delete-item-title').textContent = item.title;
  $('#delete-future').hidden = future < 2;
  $('#delete-future').textContent = `이 날짜부터 ${future}개 삭제`;
  $('#delete-dialog').showModal();
};
$('#cancel-delete').onclick = () => $('#delete-dialog').close();
$('#confirm-delete').onclick = async () => {
  const button = $('#confirm-delete'); button.disabled = true;
  try {await api(`/api/items/${state.editing.id}`,{method:'DELETE',body:JSON.stringify({expected_revision:state.editing.revision})}); $('#delete-dialog').close(); $('#editor').close(); toast('삭제했습니다.'); await refresh();}
  catch(error) {if (error.status === 409) {$('#delete-dialog').close(); showConflict('delete');} else toast(error.message);}
  finally {button.disabled = false;}
};
$('#delete-future').onclick = async () => {
  const button = $('#delete-future'); button.disabled = true;
  try {
    const result = await api(`/api/items/${state.editing.id}`, {method:'DELETE', body:JSON.stringify({expected_revision:state.editing.revision, future:true})});
    $('#delete-dialog').close(); $('#editor').close(); await refresh();
    toast(`${result.deleted}개 반복 기록을 삭제했습니다.`);
  } catch(error) {if (error.status === 409) {$('#delete-dialog').close(); showConflict('delete-future');} else toast(error.message);}
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
    const itemId = state.editing.id, deleting = conflictAction === 'delete' || conflictAction === 'delete-future';
    await api(`/api/items/${itemId}`,{method:deleting ? 'DELETE' : 'PATCH',body:deleting ? JSON.stringify({future:conflictAction === 'delete-future'}) : JSON.stringify(Object.fromEntries(new FormData($('#editor-form'))))});
    $('#conflict-dialog').close(); $('#editor').close(); await refresh();
    toast(deleting ? '삭제했습니다.' : '내 내용으로 저장했습니다.');
  } catch(error) {toast(error.message);}
  finally {button.disabled = false;}
};
function moveCalendar(offset) {
  if (state.calendarMode === 'week') {
    const day = new Date(`${state.selectedDay}T12:00:00`);
    day.setDate(day.getDate() + offset * 7);
    state.month = new Date(day.getFullYear(), day.getMonth(), 1);
    state.selectedDay = localDate(day);
    state.preferredDay = day.getDate();
    renderCalendar(scoped(state.items));
    return;
  }
  const target = new Date(state.month.getFullYear(), state.month.getMonth() + offset, 1);
  const day = Math.min(state.preferredDay, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  state.month = target;
  state.selectedDay = localDate(new Date(target.getFullYear(), target.getMonth(), day));
  renderCalendar(scoped(state.items));
}
$('#prev-month').onclick = () => moveCalendar(-1);
$('#next-month').onclick = () => moveCalendar(1);
document.querySelectorAll('[data-calendar-mode]').forEach(button => {
  button.onclick = () => {state.calendarMode = button.dataset.calendarMode; renderCalendar(scoped(state.items));};
});
$('#go-today').onclick = () => {const today = new Date(); state.month = today; state.selectedDay = localDate(today); state.preferredDay = today.getDate(); renderCalendar(scoped(state.items));};
$('#calendar-grid').onkeydown = event => {
  const day = event.target.closest('.calendar-day');
  const offset = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
  if (!day || offset === undefined) return;
  event.preventDefault();
  const next = new Date(`${day.dataset.day}T12:00:00`);
  next.setDate(next.getDate() + offset);
  selectCalendarDay(localDate(next));
};
async function toggleCompact(value = !desktopCompact) {
  if (!window.todoDesktop) return;
  try {await window.todoDesktop.compact(value);} catch(error) {toast(error.message);}
}
function syncCompactDraftIndicator() {
  const button = $('#compact-button');
  const hasDraft = Boolean($('#compact-input').value.trim());
  button.classList.toggle('has-draft', hasDraft);
  button.title = hasDraft ? '작은 메모 초안 이어쓰기' : '작은 메모 모드';
  button.setAttribute('aria-label', button.title);
  button.querySelector('span').textContent = hasDraft ? '초안 이어쓰기' : '작게 보기';
  localStorage.setItem('todo-compact-draft-v1', JSON.stringify({title:$('#compact-input').value, scope:$('#compact-scope').value, kind:compactKind}));
}
function setCompactKind(kind) {
  compactKind = kind;
  document.querySelectorAll('[data-compact-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.compactKind === kind)));
  const label = kind === 'idea' ? '아이디어 한 줄 적기' : '오늘 할 일 적기';
  $('#compact-input').placeholder = `${label}…`;
  $('#compact-input').setAttribute('aria-label', label);
  syncCompactDraftIndicator();
  $('#compact-list').scrollTop = 0;
  renderCompact(state.items);
}
function restoreCompactDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('todo-compact-draft-v1') || '{}');
    if (typeof draft.title === 'string') $('#compact-input').value = draft.title.slice(0, 200);
    if (['personal','work'].includes(draft.scope)) $('#compact-scope').value = draft.scope;
    setCompactKind(draft.kind === 'idea' ? 'idea' : 'task');
  } catch {localStorage.removeItem('todo-compact-draft-v1'); setCompactKind('task');}
}
$('#compact-button').onclick = () => toggleCompact(true);
$('#expand-button').onclick = () => toggleCompact(false);
$('#compact-input').addEventListener('input', syncCompactDraftIndicator);
$('#compact-scope').addEventListener('change', () => {syncCompactDraftIndicator(); $('#compact-list').scrollTop = 0; renderCompact(state.items);});
document.querySelectorAll('[data-compact-kind]').forEach(button => {button.onclick = () => setCompactKind(button.dataset.compactKind);});
$('#fold-button').onclick = $('#compact-fold').onclick = async () => {try {await window.todoDesktop.fold();} catch(error) {toast(error.message);}};
document.querySelectorAll('[data-window-action]').forEach(button => {
  button.onclick = async () => {
    button.closest('.window-menu')?.removeAttribute('open');
    try {await window.todoDesktop.windowControl(button.dataset.windowAction);} catch(error) {toast(error.message);}
  };
});
$('#compact-form').onsubmit = async event => {
  event.preventDefault();
  if (compactSaving) return;
  const input = $('#compact-input'), title = input.value.trim(), scope = $('#compact-scope').value, kind = compactKind;
  if (!title) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  compactSaving = true; button.disabled = true;
  try {await api('/api/items',{method:'POST',body:JSON.stringify({title,kind,scope,date:kind === 'task' ? localDate(new Date()) : ''})}); if (input.value.trim() === title && scope === $('#compact-scope').value && kind === compactKind) {input.value = ''; syncCompactDraftIndicator();} await refresh(); toast(kind === 'idea' ? '아이디어 보관함에 담았어요.' : '오늘 페이지에 적었어요.');}
  catch(error) {toast(error.message);}
  finally {compactSaving = false; button.disabled = false; syncCompactDraftIndicator();}
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
    if (file.size > 100_000_000) throw new Error('100MB 이하의 백업 파일만 가져올 수 있습니다.');
    const data = JSON.parse(await file.text());
    const result = await api('/api/import',{method:'POST',body:JSON.stringify(data)});
    await refresh(); toast(`${result.imported}개 가져옴 · ${result.skipped}개 중복`);
  } catch(error) {toast(error.message);}
};
async function initializeDesktop() {
  if (!window.todoDesktop) return;
  document.body.classList.add('desktop-app');
  window.todoDesktop.onCloseRequested(requestCloseApp);
  window.todoDesktop.onReminderOpened(openReminderItem);
  const preferences = await window.todoDesktop.state();
  $('#export-button').closest('.connect-panel').querySelector('.backup-actions').insertAdjacentHTML('afterend', '<div class="auto-backup-block"><p id="auto-backup-status" role="status" aria-live="polite"></p><div class="auto-backup-actions"><button class="subtle-button" id="backup-now" type="button">지금 백업</button><button class="subtle-button" id="open-backup-folder" type="button">백업 폴더 열기 ↗</button></div><small>앱을 켜 둔 동안 30분마다 확인하고 최근 7일분을 보관합니다.</small></div>');
  const showBackupStatus = status => {
    const last = status?.lastAt ? new Intl.DateTimeFormat('ko-KR', {dateStyle:'medium',timeStyle:'short'}).format(new Date(status.lastAt)) : null;
    const label = status?.error ? `자동 백업 실패 · ${status.error}` : status?.empty ? '기록이 비어 있어 기존 백업을 유지했습니다.' : last ? `최근 자동 백업 · ${last} · ${status.count}일분 보관` : '첫 기록을 만들면 자동 백업을 시작합니다.';
    $('#auto-backup-status').textContent = label;
    $('#auto-backup-status').classList.toggle('error', Boolean(status?.error));
  };
  showBackupStatus(preferences.backup);
  window.todoDesktop.onBackupChanged(showBackupStatus);
  $('#backup-now').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try {const status = await window.todoDesktop.backupNow(); showBackupStatus(status); toast(status.busy ? '백업 중입니다. 잠시 후 다시 눌러 주세요.' : status.error || (status.empty ? '백업할 기록이 없습니다.' : '현재 기록을 백업했습니다.'));}
    catch(error) {toast(error.message);}
    finally {button.disabled = false;}
  };
  $('#open-backup-folder').onclick = async () => {try {await window.todoDesktop.backupFolder();} catch(error) {toast(error.message);}};
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
  window.todoDesktop.onCompactChanged(value => {desktopCompact = value; document.body.classList.toggle('compact-app', value); if (value && $('#compact-input').value.trim()) $('#compact-input').focus(); refresh();});
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
  if (preferences.reminderId) await openReminderItem(preferences.reminderId);
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
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    const menu = document.querySelector('.window-menu[open]');
    if (menu) {event.preventDefault(); menu.open = false; menu.querySelector('summary').focus();}
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'k') {event.preventDefault(); openSearch();}
  if (window.todoDesktop && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {event.preventDefault(); toggleCompact();}
  if (!desktopCompact && event.ctrlKey && event.key.toLowerCase() === 'n') {event.preventDefault(); if (!document.querySelector('dialog[open]')) openEditor();}
});
restoreCompactDraft();
initializeDesktop().then(refresh).catch(error => toast(error.message));
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => {if (!document.hidden) refresh();});
setInterval(() => {if (!document.hidden) refresh();}, 20000);
