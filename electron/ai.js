const providers = {
  openai: {url: 'https://api.openai.com/v1/responses', model: 'gpt-6-luna'},
  anthropic: {url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-5'}
};

async function brief(provider, apiKey, entries, fetchImpl = fetch) {
  if (!providers[provider]) throw new Error('지원하지 않는 AI 제공자입니다.');
  if (!apiKey) throw new Error('먼저 API 키를 연결하세요.');
  if (!Array.isArray(entries) || entries.length === 0) return '오늘 예정된 항목이 없어요. 할 일을 하나 적으면 함께 정리할 수 있어요.';
  const schedule = entries.slice(0, 20).map(item => `- ${item.time || '시간 미정'} ${item.title.slice(0, 200)}${item.priority === 'high' ? ' (중요)' : ''}`).join('\n');
  const prompt = `다음은 사용자가 명시적으로 선택한 오늘의 할 일과 일정입니다. 한국어로 3문장 이내의 간결한 실행 순서와 한 가지 현실적인 시작 행동을 제안하세요. 없는 일정이나 시간을 지어내지 마세요.\n\n${schedule}`;
  const config = providers[provider];
  const options = provider === 'openai'
    ? {headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'}, body: {model: config.model, input: prompt, reasoning: {effort: 'none'}, max_output_tokens: 500, store: false}}
    : {headers: {'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'}, body: {model: config.model, messages: [{role: 'user', content: prompt}], max_tokens: 500}};
  const response = await fetchImpl(config.url, {method: 'POST', headers: options.headers, body: JSON.stringify(options.body), signal: AbortSignal.timeout(30000)});
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? 'API 키를 확인하세요.' : `AI 요청에 실패했습니다. (${response.status})`);
  const text = provider === 'openai'
    ? data.output?.flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('\n')
    : data.content?.filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (!text) throw new Error('AI 응답에서 텍스트를 찾지 못했습니다.');
  return text;
}

module.exports = {brief, providers};
