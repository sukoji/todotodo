function dueReminder(item, now, reminderMinutes) {
  if (item.status === 'done' || item.kind === 'idea' || !item.date || !item.time) return null;
  const start = new Date(`${item.date}T${item.time}:00`).getTime();
  if (!Number.isFinite(start) || now < start - reminderMinutes * 60000 || now > start + 5 * 60000) return null;
  const remaining = Math.ceil((start - now) / 60000);
  const timing = remaining > 0 ? `${remaining}분 후 예정` : remaining < 0 ? `${-remaining}분 전 시작` : '지금 예정';
  return {key: `${item.id}:${item.date}:${item.time}:${reminderMinutes}`, body: `${timing} · ${item.scope === 'work' ? '업무' : '개인'}`};
}

function pruneReminderHistory(history, now) {
  return Object.fromEntries(Object.entries(history && typeof history === 'object' && !Array.isArray(history) ? history : {})
    .filter(([,sentAt]) => Number.isFinite(sentAt) && sentAt >= now - 2 * 86400000));
}

module.exports = {dueReminder, pruneReminderHistory};
