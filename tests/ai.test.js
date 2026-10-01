const assert = require('node:assert/strict');
const test = require('node:test');
const {brief} = require('../electron/ai');

test('OpenAI brief sends only the selected schedule and omits stored details', async () => {
  let request;
  const answer = await brief('openai', 'private-key', [{title: '회의 준비', time: '10:00', end_time: '11:00', priority: 'high', details: 'private details'}], async (url, options) => {
    request = {url, options};
    return {ok: true, json: async () => ({output: [{content: [{type: 'output_text', text: '회의 전에 자료를 확인하세요.'}]}]})};
  });
  assert.equal(answer, '회의 전에 자료를 확인하세요.');
  assert.match(request.url, /openai.com/);
  assert.equal(request.options.headers.Authorization, 'Bearer private-key');
  assert.match(request.options.body, /10:00–11:00/);
  assert.doesNotMatch(request.options.body, /private details/);
});

test('Claude brief returns text without requiring app server credentials', async () => {
  const answer = await brief('anthropic', 'private-key', [{title: '산책', time: ''}], async (_url, options) => {
    assert.equal(options.headers['x-api-key'], 'private-key');
    return {ok: true, json: async () => ({content: [{type: 'text', text: '가볍게 산책을 시작하세요.'}]})};
  });
  assert.equal(answer, '가볍게 산책을 시작하세요.');
});
