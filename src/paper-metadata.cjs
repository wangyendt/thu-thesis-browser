'use strict';

const SITE = 'https://newetds.lib.tsinghua.edu.cn';
function isSummaryURL(value) {
  try { const url = new URL(value); return url.origin === SITE && url.pathname === '/qh/paper/summary'; }
  catch { return false; }
}

// Only read the thesis summary, never login forms, search inputs, or user profiles.
function readPaperMetadata() {
  if (location.origin !== 'https://newetds.lib.tsinghua.edu.cn' || location.pathname !== '/qh/paper/summary') return null;
  const root = document.querySelector('.XwlwGl');
  if (!root) return null;
  const text = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const fields = {};
  for (const li of root.querySelectorAll('.infoBox li')) {
    const divs = [...li.children].filter(node => node.tagName === 'DIV');
    if (divs.length === 2) fields[text(divs[0]).replace(/[：:]$/, '')] = text(divs[1]);
  }
  return {
    title: text(root.querySelector('.titleBox .cn')) || text(root.querySelector('.titleBox .en')),
    author: text(root.querySelector('.authorBox span')).replace(/^(?:作者|姓名)\s*[：:]\s*/, ''),
    college: fields['学院'] || fields['院系'] || fields['培养单位'],
    student: fields['学号'], discipline: fields['学科名'] || fields['专业'],
    degree: fields['学位'], date: fields['答辩日期'] || fields['年度'],
    sourceURL: location.href
  };
}

function clean(value) {
  if (typeof value !== 'string') return '';
  if (/^(?:暂无|未知|不详|无|未提供|未公开|保密|null|undefined|n\/?a|-+)$/i.test(value.trim())) return '';
  const text = value.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ').replace(/_+/g, '_').replace(/^[. _]+|[. _]+$/g, '').trim();
  return text;
}
function truncate(value, bytes) {
  let result = '';
  for (const char of value) {
    if (Buffer.byteLength(result + char, 'utf8') > bytes) break;
    result += char;
  }
  return result.replace(/[. _]+$/g, '');
}
function buildPaperFilename(metadata = {}, fallback = '论文.pdf') {
  const title = clean(metadata?.title) || clean(String(fallback).replace(/\.pdf$/i, '')) || '论文';
  // Preserve masking instead of inventing hidden digits; ASCII * is illegal on Windows.
  const student = typeof metadata?.student === 'string' && /[\p{L}\p{N}]/u.test(metadata.student)
    ? metadata.student.replace(/[*＊]/g, 'x') : '';
  const date = clean(metadata?.date).replace(/^(\d{4})[./年](\d{1,2})[./月](\d{1,2})日?$/, '$1-$2-$3');
  const values = [title, metadata?.author, metadata?.college, student, metadata?.discipline, metadata?.degree, date];
  const limits = [120, 30, 48, 30, 36, 18, 12];
  const seen = new Set();
  const parts = values.map((value, i) => truncate(clean(value), limits[i])).filter(value => {
    if (!value || seen.has(value)) return false;
    seen.add(value); return true;
  });
  // Leave room for the atomic .<filename>.<uuid>.part file on 255-byte filesystems.
  while (Buffer.byteLength(parts.join('_') + '.pdf', 'utf8') > 200) {
    const index = parts.reduce((longest, part, i) => Buffer.byteLength(part) > Buffer.byteLength(parts[longest]) ? i : longest, 0);
    parts[index] = [...parts[index]].slice(0, -1).join('');
  }
  let basename = parts.join('_').replace(/[. _]+$/g, '') || '论文';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename)) basename = '_' + basename;
  return basename + '.pdf';
}

module.exports = { isSummaryURL, buildPaperFilename, READ_METADATA_SCRIPT: `(${readPaperMetadata.toString()})();` };
