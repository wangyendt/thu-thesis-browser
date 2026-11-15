'use strict';

const SITE = 'https://newetds.lib.tsinghua.edu.cn';
const HOME = `${SITE}/qh/cjjs?searchIndex=1&searchType=1&conditionKey=%E5%AD%A6%E7%A7%91%E5%90%8D&txtKeyword=`;

function isInternalURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
      (u.hostname === 'tsinghua.edu.cn' || u.hostname.endsWith('.tsinghua.edu.cn'));
  } catch { return false; }
}

function isSiteURL(value) {
  try { return new URL(value).origin === SITE; } catch { return false; }
}

function isExternalURL(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}

function normalizeSearch(input) {
  const result = {};
  for (const field of ['student', 'discipline', 'title']) {
    if (typeof input?.[field] !== 'string' || input[field].length > 200) throw new Error('检索条件过长或格式不正确');
    result[field] = input[field].trim();
  }
  result.exact = input.exact === true;
  if (!result.student && !result.discipline && !result.title) throw new Error('请至少填写一个检索条件');
  return result;
}

module.exports = { SITE, HOME, isInternalURL, isSiteURL, isExternalURL, normalizeSearch };
