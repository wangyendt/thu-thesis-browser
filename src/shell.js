'use strict';
const $ = id => document.getElementById(id);
const command = async (action, payload) => {
  try { return await window.browser.command(action, payload); }
  catch (error) {
    const message = `客户端命令调用失败：${error.message}`;
    $('status').textContent = message;
    return { ok: false, error: message };
  }
};
let state = null, initialized = false;
let saving = false;
$('save-pdf').addEventListener('click', async () => {
  if (saving) return;
  saving = true; $('save-pdf').disabled = true;
  try { await command('save-pdf'); }
  finally { saving = false; updateSaveButton(); command('state'); }
});
for (const action of ['back', 'forward', 'reload', 'copy', 'external', 'choose-directory', 'open-directory']) {
  $(action).addEventListener('click', () => command(action));
}
$('downloads').addEventListener('click', () => command('panel', 'downloads'));
$('help').addEventListener('click', () => command('panel', 'help'));
$('close-panel').addEventListener('click', () => command('panel', state?.panel));
$('address-form').addEventListener('submit', event => { event.preventDefault(); command('navigate', $('address').value); });
$('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('search').disabled = true;
  try { await command('search', { student: $('student').value, discipline: $('discipline').value, title: $('title').value, exact: $('exact').checked }); }
  finally { $('search').disabled = false; }
});
function button(text, handler, className) {
  const element = document.createElement('button');
  element.textContent = text; element.className = className || ''; element.addEventListener('click', handler);
  return element;
}
function bytes(value) { return value > 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`; }
function updateSaveButton() {
  const current = state?.tabs.find(t => t.active);
  let viewerPage = false;
  try { const u = new URL(current?.url); viewerPage = u.origin === 'https://newetds.lib.tsinghua.edu.cn' && u.pathname === '/pdf/generic/web/viewer.html'; } catch {}
  $('save-pdf').disabled = saving || !!current?.saving || !viewerPage;
  $('save-pdf').textContent = current?.savePhase || (saving ? '选择保存位置…' : '保存当前 PDF');
  $('save-pdf').title = viewerPage ? '先弹出另存为窗口，再读取当前 PDF；保留原有水印' : '请先打开论文 PDF 预览标签页';
}
window.browser.onState(next => {
  state = next;
  if (!initialized) {
    for (const key of ['student', 'discipline', 'title']) $(key).value = next.search[key];
    $('exact').checked = next.search.exact; initialized = true;
  }
  const current = next.tabs.find(t => t.active);
  if (document.activeElement !== $('address')) $('address').value = current?.url || '';
  $('back').disabled = !current?.back; $('forward').disabled = !current?.forward;
  updateSaveButton();
  $('app-version').textContent = `v${next.version}`;
  document.title = `论文检索 · Thesis Browser v${next.version}`;
  const tabs = next.tabs.map(tab => {
    const element = document.createElement('div'); element.className = `tab${tab.active ? ' active' : ''}`;
    const select = button(`${tab.loading ? '◌ ' : ''}${tab.title}`, () => command('select', tab.id), 'tab-title');
    select.title = tab.title;
    const close = button('×', () => command('close', tab.id), 'tab-close');
    close.setAttribute('aria-label', `关闭 ${tab.title}`);
    element.append(select, close); return element;
  });
  const add = button('+', () => command('home'), 'new-tab'); add.title = '新建检索标签页'; add.setAttribute('aria-label', '新建检索标签页');
  $('tabs').replaceChildren(...tabs, add);
  $('patch-state').textContent = current?.patched ? '检索修正已启用' : '原站浏览';
  $('patch-state').className = `badge${current?.patched ? ' ready' : ''}`;
  $('status').textContent = current?.error || next.message || '登录、预览与下载沿用网站原有权限。';
  $('loading').textContent = current?.loading ? '网页加载中…' : '';
  $('panel').hidden = !next.panel;
  $('panel-title').textContent = next.panel === 'help' ? '使用说明' : '下载';
  $('download-panel').hidden = next.panel !== 'downloads'; $('help-panel').hidden = next.panel !== 'help';
  $('download-directory').textContent = next.downloadDirectory;
  $('download-count').textContent = next.downloads.length;
  const items = next.downloads.toReversed().map(d => {
    const element = document.createElement('div'); element.className = 'download-item';
    const name = document.createElement('strong'); name.textContent = d.filename;
    const description = document.createElement('p');
    const labels = { preparing: '正在读取完整 PDF', saving: '正在写入文件', failed: '保存失败', progressing: '正在下载', interrupted: '下载中断，请在网页重新下载', cancelled: '已取消', completed: '下载完成' };
    description.textContent = d.error ? `保存失败：${d.error}` : `${labels[d.state] || d.state} · ${bytes(d.received)}${d.total ? ` / ${bytes(d.total)}` : ''}`;
    element.append(name, description);
    if (d.state === 'progressing') {
      const progress = document.createElement('progress');
      if (d.total) { progress.max = d.total; progress.value = d.received; }
      element.append(progress, button('取消', () => command('cancel-download', d.id), 'quiet'));
    }
    if (d.state === 'completed') element.append(button('在文件夹中显示', () => command('reveal', d.id), 'quiet'));
    return element;
  });
  if (!items.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '本次会话还没有下载文件。'; items.push(p); }
  $('download-list').replaceChildren(...items);
});
command('state');
