function timeOverlaps(a, b) {
  return Boolean(a.id !== b.id && a.date && a.date === b.date &&
    a.kind !== 'idea' && b.kind !== 'idea' && a.status !== 'done' && b.status !== 'done' &&
    a.time && a.end_time && b.time && b.end_time &&
    a.time < a.end_time && b.time < b.end_time &&
    a.time < b.end_time && b.time < a.end_time);
}

function timeConflictPairs(items) {
  const timed = items.filter(item => item.kind !== 'idea' && item.status !== 'done' && item.date && item.time && item.end_time && item.time < item.end_time);
  const pairs = [];
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++)
      if (timeOverlaps(timed[i], timed[j])) pairs.push([timed[i], timed[j]]);
  return pairs;
}

if (typeof module !== 'undefined') module.exports = {timeOverlaps, timeConflictPairs};
