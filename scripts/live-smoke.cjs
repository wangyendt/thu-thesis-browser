'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, remote, waitFor, screenshot, OUTPUT } = require('./test-helpers.cjs');
const { READ_METADATA_SCRIPT, buildPaperFilename } = require('../src/paper-metadata.cjs');

(async () => {
  const { application, window } = await launch(path.join(OUTPUT, `live-profile-${Date.now()}`));
  try {
    await waitFor(() => remote(application, "document.readyState === 'complete' && !!window.__THESIS_BROWSER_PATCH__ && typeof searchFun === 'function'"), 60000);
    await window.locator('#search').click();
    const count = await waitFor(() => remote(application, `(() => { const e = document.querySelector('#txtPagecountAll') || [...document.querySelectorAll('[id^="txtPagecount"]')].find(e=>e.getClientRects().length); const n=Number(e?.textContent); return n>0 && n<5000 ? n : 0; })()`), 30000);
    assert.ok(count > 0);
    const payload = await remote(application, "JSON.stringify(buildParamAdvance(1))");
    const conditions = JSON.parse(payload).searchConditions;
    assert.ok(conditions.some(c => c.conditionKey === '专业' && c.conditionValue === '工程管理'));
    assert.ok(conditions.some(c => c.conditionKey === '学号' && c.conditionValue === '2022'));
    console.log(`PASS: live official site returned ${count} matching papers`);
    await screenshot(application, 'live-search.png');
    const paper = await remote(application, `(() => { const a = [...document.querySelectorAll('.dataInfo a')].find(a=>a.getClientRects().length); if(!a)throw Error('无论文链接'); const result={title:a.textContent.trim(),url:a.href}; a.click(); return result; })()`);
    await waitFor(() => remote(application, "document.readyState === 'complete' && document.body.innerText.includes('学科名')", 1));
    const metadata = await remote(application, `(() => { const result={};for(const li of document.querySelectorAll('li')){const d=[...li.children].filter(x=>x.tagName==='DIV');if(d.length===2 && ['学号','学科名'].includes(d[0].textContent.trim()))result[d[0].textContent.trim()]=d[1].textContent.trim();}return result;})()`, 1);
    assert.equal(metadata['学科名'], '工程管理');
    assert.ok(metadata['学号'].includes('2022'));
    const paperMetadata = await remote(application, READ_METADATA_SCRIPT, 1);
    assert.equal(paperMetadata.title, paper.title);
    assert.ok(paperMetadata.author);
    assert.equal(Object.hasOwn(paperMetadata, 'student'), false);
    assert.equal(paperMetadata.discipline, '工程管理');
    assert.ok(paperMetadata.college);
    console.log('PASS: real thesis summary metadata extracted; default filename: ' + buildPaperFilename(paperMetadata));
    console.log('PASS: embedded detail tab confirms subject and masked 2022 student ID');
    console.log(JSON.stringify({ count, sample: paper, metadata }, null, 2));
    await screenshot(application, 'live-detail.png');
    // Do not attempt login or an actual protected thesis download in an unauthenticated test.
    console.log('Live download authorization not exercised; native download verified with synthetic fixture.');
    if (process.env.THESIS_BROWSER_VISUAL_CHECK) {
      console.log('Holding the test app open for native visual inspection (up to 180 seconds).');
      await new Promise(resolve => setTimeout(resolve, 180000));
    }
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
