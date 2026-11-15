'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PATCH_SCRIPT } = require('../src/site-patch.cjs');

function environment(origin = 'https://newetds.lib.tsinghua.edu.cn') {
  const calls = [];
  class XHR {
    open(...args) { this.args = args; }
    send(body) { calls.push({ url: this.args[1], body }); }
  }
  const context = vm.createContext({
    location: { origin, href: `${origin}/qh/cjjs` }, URL, Request,
    XMLHttpRequest: XHR,
    fetch: async (input, init) => { calls.push({ input, init }); return 'ok'; },
    ConditionKeyMapping: key => key === 'Discipline' ? '学科名' : key
  });
  vm.runInContext('window = globalThis', context);
  return { context, calls, run: script => vm.runInContext(script, context) };
}
const body = JSON.stringify({
  conditionKey: '学科名', conditionValue: '工程管理',
  searchConditions: [
    { conditionKey: '学科名', conditionValue: '工程管理', subConditionQuery: 'AND' },
    { conditionKey: '学号', conditionValue: '2022', subConditionQuery: 'LIKE' }
  ]
});
test('rewrites real XHR payload while preserving all values/operators', () => {
  const env = environment(); env.run(PATCH_SCRIPT);
  env.context.body = body;
  env.run(`const xhr = new XMLHttpRequest(); xhr.open('POST', '/qh/qhSearch/qhGetSingleList'); xhr.send(body);`);
  const result = JSON.parse(env.calls[0].body);
  assert.equal(result.conditionKey, '专业');
  assert.deepEqual(result.searchConditions, [
    { conditionKey: '专业', conditionValue: '工程管理', subConditionQuery: 'AND' },
    { conditionKey: '学号', conditionValue: '2022', subConditionQuery: 'LIKE' }
  ]);
});
test('does not modify login, unrelated API, or lookalike origin requests', () => {
  const env = environment(); env.run(PATCH_SCRIPT); env.context.body = body;
  for (const url of ['/qh/login', '/qh/qhSearch/qhGetSingleListExtra', 'https://newetds.lib.tsinghua.edu.cn.evil.test/qh/qhSearch/qhGetSingleList']) {
    env.context.testURL = url;
    env.run(`{ const xhr = new XMLHttpRequest(); xhr.open('POST', testURL); xhr.send(body); }`);
  }
  assert.ok(env.calls.every(call => call.body === body));
});
test('malformed or non-JSON bodies pass through unchanged', () => {
  const env = environment(); env.run(PATCH_SCRIPT);
  for (const value of ['not-json', 'null', '[]', '42']) {
    env.context.body = value;
    env.run(`{ const xhr = new XMLHttpRequest(); xhr.open('POST', '/qh/qhSearch/qhGetSingleList'); xhr.send(body); }`);
    assert.equal(env.calls.at(-1).body, value);
  }
});
test('fetch init preserves credentials/headers and updates only the body', async () => {
  const env = environment(); env.run(PATCH_SCRIPT); env.context.body = body;
  await env.run(`fetch('/qh/qhSearch/qhGetSingleList', {method:'POST', body, credentials:'same-origin', headers:{'Content-Type':'application/json'}})`);
  assert.equal(env.calls[0].init.credentials, 'same-origin');
  assert.equal(env.calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(env.calls[0].init.body).conditionKey, '专业');
});
test('fetch Request body is corrected without consuming original Request', async () => {
  const env = environment(); env.run(PATCH_SCRIPT);
  const request = new Request('https://newetds.lib.tsinghua.edu.cn/qh/qhSearch/qhGetSingleList', { method: 'POST', body });
  env.context.request = request;
  await env.run('fetch(request)');
  assert.equal(JSON.parse(await env.calls[0].input.text()).conditionKey, '专业');
  assert.equal(request.bodyUsed, false);
});
test('mapping wrapper is correct and patch is idempotent', () => {
  const env = environment(); env.run(PATCH_SCRIPT);
  const fetch = env.context.fetch;
  assert.equal(env.run(`ConditionKeyMapping('学科名')`), '专业');
  assert.equal(env.run(`ConditionKeyMapping('Discipline')`), '专业');
  assert.equal(env.run(`ConditionKeyMapping('学号')`), '学号');
  env.run(PATCH_SCRIPT); assert.equal(env.context.fetch, fetch);
});
test('does not inject on a different origin', () => {
  const env = environment('https://id.tsinghua.edu.cn');
  assert.equal(env.run(PATCH_SCRIPT), false);
  assert.equal(env.context.__THESIS_BROWSER_PATCH__, undefined);
});
