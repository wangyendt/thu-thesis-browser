'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isInternalURL, isSiteURL, isExternalURL, normalizeSearch } = require('../src/policy.cjs');
test('only HTTPS Tsinghua domains may navigate inside the remote view', () => {
  for (const url of ['https://newetds.lib.tsinghua.edu.cn/qh/cjjs', 'https://id.tsinghua.edu.cn/login', 'https://tsinghua.edu.cn']) assert.ok(isInternalURL(url));
  for (const url of ['http://newetds.lib.tsinghua.edu.cn', 'file:///C:/secret', 'javascript:alert(1)', 'https://tsinghua.edu.cn.evil.test', 'https://eviltsinghua.edu.cn']) assert.equal(isInternalURL(url), false);
  assert.equal(isSiteURL('https://id.tsinghua.edu.cn'), false);
});
test('OS browser links cannot launch executables or custom protocol handlers', () => {
  for (const url of ['file:///C:/Windows/cmd.exe', 'powershell:bad', 'javascript:bad', 'https://user:password@example.com']) assert.equal(isExternalURL(url), false);
  assert.ok(isExternalURL('https://lib.tsinghua.edu.cn'));
});
test('search fields are bounded, trimmed, and preserve literal user input', () => {
  assert.deepEqual(normalizeSearch({ student: ' 2022 ', discipline: ' 工程管理 ', title: '"test"', exact: true }), { student: '2022', discipline: '工程管理', title: '"test"', exact: true });
  assert.throws(() => normalizeSearch({ student: '', discipline: '', title: '' }));
  assert.throws(() => normalizeSearch({ student: 2022, discipline: '', title: '' }));
  assert.throws(() => normalizeSearch({ student: 'x'.repeat(201), discipline: '', title: '' }));
});
