'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, remote, waitFor, screenshot, OUTPUT } = require('./test-helpers.cjs');

(async () => {
  const profile = path.join(OUTPUT, `fixture-profile-${Date.now()}`);
  const { application, window } = await launch(profile);
  const savedFile = path.join(OUTPUT, `download-fixture-${Date.now()}.pdf`);
  try {
    assert.equal(await window.locator('.brand-icon').evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }), true);
    console.log('PASS: shared application icon loads in the local toolbar');
    await application.evaluate(async ({ session }, savedFile) => {
      const ses = session.fromPartition('persist:thesis-browser');
      globalThis.__testRequests = [];
      ses.on('will-download', (_event, item) => item.setSavePath(savedFile));
      await ses.protocol.handle('https', async request => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/qhGetSingleList')) {
          const p = await request.json(); globalThis.__testRequests.push(p);
          const subject = p.searchConditions.find(c => c.conditionValue === '工程管理');
          const student = p.searchConditions.find(c => c.conditionKey === '学号');
          const count = subject?.conditionKey === '专业' && student?.conditionValue === '2022' ? 71 : 0;
          return new Response(JSON.stringify({ countNumber: count, pageIndex: p.pageIndex, qhlwdataList: count ? [{ 中文题名: '测试论文' }] : [] }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/test/download') return new Response('%PDF-1.4\n% local synthetic download fixture\n%%EOF', { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="fixture.pdf"' } });
        if (url.pathname.includes('/summary')) return new Response('<!doctype html><meta charset="utf-8"><title>测试论文详情</title><h1>测试论文详情</h1><p>学科名：工程管理</p><a id="download" href="/test/download">下载测试 PDF</a>', { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
        const row = () => '<div class="ztj"><div class="tj"><input value="并且"></div><div class="sBox"><div class="tm"><input value="题名"></div><div class="sr"><input></div><div class="tj1"><input value="部分匹配"></div></div></div>';
        return new Response(`<!doctype html><meta charset="utf-8"><title>测试清华论文库</title><style>body{font-family:sans-serif;padding:30px}.ztj{display:flex;margin:10px}.sBox{display:flex}#results{font-size:30px}</style>
          <div class="GJJS"><div id="sKeyWrap0">${row()}${row()}${row()}</div></div>
          <input id="searchType"><input id="searchScope"><input id="calendar0"><input id="calendar1"><input id="txtXwType"><input id="txtXkxz">
          <div id="results">等待检索</div><a id="paper" target="_blank" href="/qh/paper/summary?dbCode=ETDQH&sysId=1">测试论文详情</a><button id="next" onclick="searchFun(2)">下页</button>
          <script>function ConditionKeyMapping(v){return v==='题名'?'中文题名':v;}function switchTab(){}function searchFun(pageIndex){const searchConditions=[...document.querySelectorAll('.ztj')].map((r,i)=>({conditionValueType:i?'AND':'',conditionKey:ConditionKeyMapping(r.querySelector('.tm input').value),conditionValue:r.querySelector('.sr input').value,subConditionQuery:r.querySelector('.tj1 input').value==='完全匹配'?'AND':'LIKE'}));const x=new XMLHttpRequest();x.open('POST','/qh/qhSearch/qhGetSingleList');x.setRequestHeader('Content-Type','application/json');x.onload=()=>document.getElementById('results').textContent=JSON.parse(x.responseText).countNumber+'条结果，第'+pageIndex+'页';x.send(JSON.stringify({pageIndex,searchConditions}));}</script>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
      });
    }, savedFile);
    await window.locator('#reload').click();
    await waitFor(() => remote(application, "document.title === '测试清华论文库' && !!window.__THESIS_BROWSER_PATCH__"));
    assert.equal(await remote(application, 'typeof window.require'), 'undefined');
    assert.equal(await remote(application, 'typeof window.browser'), 'undefined');
    console.log('PASS: remote website sandboxed, no native bridge');
    await window.locator('#search').click();
    await waitFor(() => remote(application, "document.getElementById('results').textContent.includes('71条结果')"));
    const request = await application.evaluate(() => globalThis.__testRequests.at(-1));
    assert.equal(request.searchConditions[0].conditionKey, '专业');
    assert.equal(request.searchConditions[0].subConditionQuery, 'AND');
    assert.equal(request.searchConditions[1].conditionValue, '2022');
    console.log('PASS: toolbar -> real XHR -> corrected subject + student -> 71 results');
    await remote(application, "document.getElementById('next').click()");
    await waitFor(() => remote(application, "document.getElementById('results').textContent.includes('第2页')"));
    console.log('PASS: pagination keeps corrected parameters');
    await screenshot(application, 'desktop-fixture.png');
    await remote(application, "document.getElementById('paper').click()");
    await waitFor(() => remote(application, "document.title === '测试论文详情'", 1));
    assert.equal(await window.locator('.tab').count(), 2);
    console.log('PASS: target=_blank opens embedded tab');
    await remote(application, "document.getElementById('download').click()", 1);
    await waitFor(() => fs.existsSync(savedFile) && fs.readFileSync(savedFile, 'utf8').startsWith('%PDF-1.4'));
    await window.locator('#download-list').getByText(/下载完成/).waitFor();
    console.log('PASS: native download event saves PDF and updates download panel');
    await application.evaluate(async ({ session }) => {
      const ses = session.fromPartition('persist:thesis-browser');
      await ses.cookies.set({ url: 'https://newetds.lib.tsinghua.edu.cn', name: 'local_fixture_cookie', value: 'test', secure: true, httpOnly: true, expirationDate: Date.now()/1000+3600 });
      await ses.cookies.flushStore();
    });
    await screenshot(application, 'desktop-download.png');
  } finally { await application.close(); }
  const second = await launch(profile);
  try {
    assert.equal(await second.application.evaluate(async ({ session }) => (await session.fromPartition('persist:thesis-browser').cookies.get({ name: 'local_fixture_cookie' })).length), 1);
    console.log('PASS: isolated persistent session survives app restart');
  } finally { await second.application.close(); }
  console.log('Desktop smoke tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
