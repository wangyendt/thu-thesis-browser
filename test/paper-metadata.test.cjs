'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { isSummaryURL, buildPaperFilename, READ_METADATA_SCRIPT } = require('../src/paper-metadata.cjs');

test('filename orders known paper fields, skipping missing values and duplicates', () => {
  assert.equal(buildPaperFilename({ title: '供应链风险研究', author: '张三', college: '经济管理学院', student: '2022123456', discipline: '工程管理', degree: '硕士', date: '2025.06.01' }),
    '供应链风险研究_张三_经济管理学院_工程管理_硕士_2025-06-01.pdf');
  assert.equal(buildPaperFilename({ title: '研究', author: '暂无', college: '', student: '***', degree: '未知', discipline: '研究' }), '研究.pdf');
  assert.equal(buildPaperFilename({ title: '研究', author: 'N/A', college: '不详', degree: '--' }), '研究.pdf');
  assert.equal(buildPaperFilename(null, '原始文件.pdf'), '原始文件.pdf');
  assert.equal(buildPaperFilename({}), '论文.pdf');
});
test('filenames are cross-platform safe and omit both full and masked student IDs', () => {
  const name = buildPaperFilename({ title: '../非法:题目/测试?', author: '张三', student: '2022******' });
  assert.equal(name, '非法_题目_测试_张三.pdf');
  assert.equal(buildPaperFilename({ title: '研究', student: '2022123456' }), '研究.pdf');
  assert.doesNotMatch(name, /[<>:"/\\|?*\x00-\x1f]/);
  assert.equal(buildPaperFilename({ title: 'CON' }), '_CON.pdf');
  assert.equal(buildPaperFilename({ title: 'NUL.foo' }), '_NUL.foo.pdf');
  assert.equal(buildPaperFilename({ title: ' ... ' }), '论文.pdf');
});
test('long Unicode names preserve each field without breaking codepoints or filesystem byte limits', () => {
  const name = buildPaperFilename({ title: '超长论文题目😀'.repeat(100), author: '作者'.repeat(50), college: '学院'.repeat(50), student: '2022123456', discipline: '工程管理', degree: '硕士', date: '2025.06.01' });
  assert.ok(Buffer.byteLength(name) <= 200);
  assert.ok(Buffer.byteLength(`.${name}.${'0'.repeat(36)}.part`) <= 255);
  assert.ok(!name.includes('\uFFFD'));
  assert.equal(name.split('_').length, 6);
  assert.ok(name.endsWith('_2025-06-01.pdf'));
});
test('summary reader is scoped to the actual thesis, not login fields or unrelated pages', () => {
  const node = textContent => ({ textContent, tagName: 'DIV' });
  const root = {
    querySelector(selector) { return node({ '.titleBox .cn': '  论文\n 题目 ', '.authorBox span': '作者：张三' }[selector] || ''); },
    querySelectorAll() { return [['学号', '2022******'], ['培养单位', '032  工物系'], ['学科名', '工程管理'], ['学位', '硕士'], ['答辩日期', '2025.09.16'], ['电子邮箱', 'not-for-filename@example.test']].map(pair => ({ children: pair.map(node) })); }
  };
  const context = { location: { origin: 'https://newetds.lib.tsinghua.edu.cn', pathname: '/qh/paper/summary', href: 'https://newetds.lib.tsinghua.edu.cn/qh/paper/summary?sysId=123' }, document: { querySelector(selector) { assert.equal(selector, '.XwlwGl'); return root; } } };
  const paper = vm.runInNewContext(READ_METADATA_SCRIPT, context);
  assert.equal(paper.title, '论文 题目');
  assert.equal(paper.author, '张三');
  assert.equal(paper.college, '032 工物系');
  assert.equal(Object.hasOwn(paper, 'student'), false, 'Filename metadata must not collect student IDs');
  assert.ok(!JSON.stringify(paper).includes('example.test'));
  context.location.pathname = '/qh/cjjs';
  assert.equal(vm.runInNewContext(READ_METADATA_SCRIPT, context), null);
  context.location.pathname = '/qh/paper/summary'; context.location.origin = 'https://evil.test';
  assert.equal(vm.runInNewContext(READ_METADATA_SCRIPT, context), null);
  assert.equal(isSummaryURL(context.location.href), true);
  assert.equal(isSummaryURL('https://evil.test/qh/paper/summary'), false);
});
