'use strict';

// Executed only in the official site's main world. No Node/native bridge is exposed.
function installSitePatch() {
  if (location.origin !== 'https://newetds.lib.tsinghua.edu.cn') return false;
  if (window.__THESIS_BROWSER_PATCH__) return true;
  const endpoint = '/qh/qhSearch/qhGetSingleList';
  const key = value => value === '学科名' || value === 'Discipline' ? '专业' : value;
  function fixBody(body) {
    if (typeof body !== 'string') return body;
    try {
      const data = JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return body;
      let changed = false;
      const fix = item => {
        if (item && key(item.conditionKey) !== item.conditionKey) {
          item.conditionKey = key(item.conditionKey); changed = true;
        }
      };
      fix(data);
      if (Array.isArray(data.searchConditions)) data.searchConditions.forEach(fix);
      return changed ? JSON.stringify(data) : body;
    } catch { return body; }
  }
  function matches(value) {
    try { const u = new URL(value, location.href); return u.origin === location.origin && u.pathname === endpoint; }
    catch { return false; }
  }
  // Covers jQuery's XHR requests, including pagination and changes to database tabs.
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    urls.set(this, url); return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    return originalSend.call(this, matches(urls.get(this)) ? fixBody(body) : body);
  };
  // Also handles fetch(string, init) and fetch(Request) without changing headers/cookies.
  const originalFetch = window.fetch;
  if (originalFetch) window.fetch = async function(input, init) {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url;
    if (!matches(url)) return originalFetch.call(this, input, init);
    if (init?.body !== undefined) return originalFetch.call(this, input, { ...init, body: fixBody(init.body) });
    if (typeof Request !== 'undefined' && input instanceof Request && !['GET', 'HEAD'].includes(input.method)) {
      const body = await input.clone().text();
      const fixed = fixBody(body);
      if (fixed !== body) return originalFetch.call(this, new Request(input, { body: fixed }), init);
    }
    return originalFetch.call(this, input, init);
  };
  // Correct the existing mapping too, so the site's own parameter builder is accurate.
  if (typeof window.ConditionKeyMapping === 'function') {
    const original = window.ConditionKeyMapping;
    window.ConditionKeyMapping = value => key(original(value));
  }
  Object.defineProperty(window, '__THESIS_BROWSER_PATCH__', { value: true });
  return true;
}

function performQuickSearch(options) {
  if (location.origin !== 'https://newetds.lib.tsinghua.edu.cn' || typeof window.searchFun !== 'function') {
    throw new Error('当前不是检索页，请等待网站加载完成');
  }
  const visible = element => element.getClientRects().length > 0;
  const rows = [...document.querySelectorAll('.ztj')].filter(visible);
  if (rows.length < 3) throw new Error('网站检索表单已变化，请使用网页内的高级检索');
  // Clear hidden template values as well: the original site serializes hidden .ztj rows.
  for (const input of document.querySelectorAll('.ztj .sr input')) input.value = '';
  const values = [['学科名', options.discipline], ['学号', options.student], ['题名', options.title]];
  rows.slice(0, 3).forEach((row, index) => {
    row.querySelector('.tm input').value = values[index][0];
    row.querySelector('.sr input').value = values[index][1];
    const join = row.querySelector('.tj input');
    if (join) join.value = '并且';
    row.querySelector('.tj1 input').value = index === 0 && options.exact ? '完全匹配' : '部分匹配';
  });
  document.getElementById('searchType').value = '1';
  document.getElementById('calendar0').value = '';
  document.getElementById('calendar1').value = '';
  document.getElementById('txtXwType').value = '全部';
  document.getElementById('txtXkxz').value = '0';
  // A toolbar search always starts in the complete database, without stale tree filters.
  const jq = window.jQuery;
  for (const id of ['treeDemo', 'treeDemoBS']) jq?.fn?.zTree?.getZTreeObj(id)?.checkAllNodes(false);
  document.getElementById('searchScope').value = '0';
  if (typeof window.switchTab === 'function') window.switchTab(1);
  window.searchFun(1);
  return true;
}

const PATCH_SCRIPT = `(${installSitePatch.toString()})();`;
const quickSearchScript = options => `(${performQuickSearch.toString()})(${JSON.stringify(options)});`;
module.exports = { installSitePatch, PATCH_SCRIPT, quickSearchScript };
