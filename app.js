'use strict';

const SOURCE_INFO = {
  history_wiki: { name: '历史上的今天', eyebrow: 'ON THIS DAY', endpoint: 'https://zh.wikipedia.org/w/api.php' },
  baidu: { name: '百度热搜', eyebrow: 'BAIDU TRENDING', endpoint: 'https://newsnow.busiyi.world/api/s?id=baidu' },
  weibo: { name: '微博热搜', eyebrow: 'WEIBO TRENDING', endpoint: 'https://newsnow.busiyi.world/api/s?id=weibo' },
  wallstreetcn: { name: '华尔街见闻', eyebrow: 'WALLSTREETCN', endpoint: 'https://newsnow.busiyi.world/api/s?id=wallstreetcn' },
  toutiao: { name: '今日头条', eyebrow: 'TOUTIAO TRENDING', endpoint: 'https://newsnow.busiyi.world/api/s?id=toutiao' },
  history: { name: '历史上的今天_百度', eyebrow: 'ON THIS DAY', endpoint: 'https://baike.baidu.com/cms/home/eventsOnHistory' }
};
const CACHE_KEY = 'today-hotboard-cache-v1';
const REFRESH_INTERVAL = 5 * 60 * 1000;
const MAX_ITEMS = 40;
let activeSource = 'history_wiki';
let cache = readCache();
let refreshInProgress = false;
let lastRefreshAttempt = 0;
let toastTimer = 0;

const els = {
  tabs: document.getElementById('sourceTabs'),
  title: document.getElementById('boardTitle'),
  eyebrow: document.getElementById('sourceEyebrow'),
  count: document.getElementById('boardCount'),
  status: document.getElementById('statusText'),
  updated: document.getElementById('lastUpdated'),
  list: document.getElementById('trendList'),
  empty: document.getElementById('emptyState'),
  retry: document.getElementById('retryBtn'),
  cacheNotice: document.getElementById('cacheNotice'),
  refresh: document.getElementById('refreshBtn'),
  today: document.getElementById('todayLabel'),
  refreshState: document.getElementById('refreshState'),
  toast: document.getElementById('toast')
};

function localDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) { return {}; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) { /* Private browsing or storage quota: keep this session working. */ }
}
function timeLabel(ts) {
  if (!ts) return '尚未成功更新';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function safeUrl(value, base = '') {
  try {
    const u = new URL(String(value || ''), base || window.location.href);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch (_) { return ''; }
}
function extractItems(json, baseUrl) {
  const list = Array.isArray(json) ? json : (json?.items || json?.data || json?.result || json?.list || []);
  if (!Array.isArray(list)) return [];
  return list.map((entry, index) => {
    if (typeof entry === 'string') return { title: entry.trim(), url: '', hot: '', rank: index + 1 };
    const title = entry?.title || entry?.name || entry?.word || entry?.desc || entry?.content || '';
    const rawUrl = entry?.url || entry?.link || entry?.mobileUrl || entry?.mobile_url || entry?.href || '';
    const hot = entry?.extra?.hot ?? entry?.hot ?? entry?.score ?? entry?.hotValue ?? '';
    return { title: String(title).trim(), url: safeUrl(rawUrl, baseUrl), hot: hot === '' ? '' : String(hot), rank: index + 1 };
  }).filter(item => item.title).slice(0, MAX_ITEMS);
}
function stripHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}
async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timeout); }
}
const STATIC_MAX_AGE = 30 * 60 * 1000;
async function fetchNewsNow(id) {
  const src = SOURCE_INFO[id];
  const make = (items, updatedAt) => ({ id, name: src.name, items, updatedAt, status: 'ok' });
  // 1) 优先读同域 data/<id>.json（由 GitHub Actions 服务器端抓取，没有跨域问题）
  let fromStatic = null;
  let staticError = '';
  try {
    const json = await fetchJson(`./data/${id}.json?t=${Date.now()}`, 10000);
    const items = extractItems(json, window.location.href);
    if (items.length) fromStatic = { items, at: Number(json.generatedAt) || 0 };
    else staticError = '数据文件为空';
  } catch (error) { staticError = readableError(error); }
  if (fromStatic && Date.now() - fromStatic.at <= STATIC_MAX_AGE) return make(fromStatic.items, fromStatic.at);
  // 2) 数据文件缺失或太旧：再尝试浏览器直连 NewsNow（可能被跨域拦截）
  try {
    const json = await fetchJson(src.endpoint, 10000);
    const items = extractItems(json, 'https://newsnow.busiyi.world/');
    if (!items.length) throw new Error('接口返回为空或数据格式发生变化');
    return make(items, Date.now());
  } catch (error) {
    // 3) 都失败：宁可显示带真实时间的旧数据，也不要空白
    if (fromStatic) return make(fromStatic.items, fromStatic.at);
    throw new Error(`同域数据：${staticError || '无'}；直连：${readableError(error)}`);
  }
}
function findDayList(json, mm, dd) {
  const key = mm + dd;
  const direct = json?.[mm]?.[key];
  if (Array.isArray(direct)) return direct;
  const stack = [json];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current[key])) return current[key];
    for (const value of Object.values(current)) if (value && typeof value === 'object') stack.push(value);
  }
  return [];
}
function parseHistory(json, mm, dd) {
  const base = 'https://baike.baidu.com';
  const typeLabel = { birth: '出生', death: '逝世' };
  return findDayList(json, mm, dd).map(event => {
    const year = String(event?.year ?? '').trim();
    const number = Number.parseInt(year, 10);
    let rawLink = event?.link || '';
    if (!rawLink) rawLink = String(event?.title || '').match(/href=["']([^"']+)["']/i)?.[1] || '';
    const label = typeLabel[event?.type] ? ` · ${typeLabel[event.type]}` : '';
    return {
      title: stripHtml(event?.title),
      url: safeUrl(rawLink, base),
      hot: year ? `${/^-/.test(year) ? '公元前' + year.slice(1) : year}年${label}` : label.replace(' · ', ''),
      sort: Number.isNaN(number) ? -99999 : number,
      isEvent: !typeLabel[event?.type]
    };
  }).filter(item => item.title)
    .sort((a, b) => (Number(b.isEvent) - Number(a.isEvent)) || (b.sort - a.sort))
    .slice(0, MAX_ITEMS)
    .map((item, index) => ({ title: item.title, url: item.url, hot: item.hot, rank: index + 1 }));
}
async function fetchHistory() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const text = await fetchText(`${SOURCE_INFO.history.endpoint}/${mm}.json`);
  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('历史接口没有返回有效 JSON'); }
  const items = parseHistory(json, mm, dd);
  if (!items.length) throw new Error('历史接口返回为空或格式发生变化');
  return { id: 'history', name: SOURCE_INFO.history.name, items, updatedAt: Date.now(), status: 'ok' };
}
function parseWikiDay(html, dayPage) {
  const source = String(html || '');
  const sections = [...source.matchAll(/<h2[\s>]/gi)].map(match => match.index);
  let section = '';
  for (let i = 0; i < sections.length; i++) {
    const end = i + 1 < sections.length ? sections[i + 1] : source.length;
    const segment = source.slice(sections[i], end);
    const headingEnd = segment.indexOf('</h2>');
    const heading = headingEnd >= 0 ? segment.slice(0, headingEnd + 5) : segment.slice(0, 500);
    if (/大事[记記]/.test(stripHtml(heading))) { section = segment; break; }
  }
  if (!section) throw new Error('维基百科页面中没有找到“大事记”章节');
  section = section.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<figure[\s\S]*?<\/figure>/gi, '').replace(/<sup[\s\S]*?<\/sup>/gi, '');
  const items = [];
  for (const match of section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = stripHtml(match[1]);
    const yearMatch = text.match(/^(公元前|前)?\s*(\d{1,4})\s*年\s*[：:]\s*([\s\S]+)$/);
    if (!yearMatch) continue;
    items.push({ title: yearMatch[3].trim(), url: dayPage, hot: `${yearMatch[1] ? '公元前' : ''}${yearMatch[2]}年` });
  }
  return items.slice(0, MAX_ITEMS).map((item, index) => ({ ...item, rank: index + 1 }));
}
async function fetchHistoryWiki() {
  const now = new Date();
  const pageTitle = `${now.getMonth() + 1}月${now.getDate()}日`;
  const dayPage = `https://zh.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`;
  const params = new URLSearchParams({ action: 'parse', page: pageTitle, prop: 'text', format: 'json', formatversion: '2', redirects: '1', uselang: 'zh-cn', origin: '*' });
  const json = await fetchJson(`${SOURCE_INFO.history_wiki.endpoint}?${params.toString()}`);
  if (json?.error) throw new Error(json.error.info || json.error.code || '维基百科接口错误');
  const html = typeof json?.parse?.text === 'string' ? json.parse.text : json?.parse?.text?.['*'];
  if (!html) throw new Error('维基百科接口返回内容为空');
  const items = parseWikiDay(html, dayPage);
  if (!items.length) throw new Error('维基百科“大事记”没有解析到条目');
  return { id: 'history_wiki', name: SOURCE_INFO.history_wiki.name, items, updatedAt: Date.now(), status: 'ok' };
}
async function fetchOne(id) {
  if (id === 'history') return fetchHistory();
  if (id === 'history_wiki') return fetchHistoryWiki();
  return fetchNewsNow(id);
}
async function refreshAll(manual = false) {
  if (refreshInProgress) return;
  refreshInProgress = true;
  lastRefreshAttempt = Date.now();
  els.refresh.classList.add('loading');
  els.refreshState.textContent = '正在更新…';
  render();
  const ids = Object.keys(SOURCE_INFO);
  await Promise.all(ids.map(async id => {
    const old = cache[id];
    try {
      const next = await fetchOne(id);
      cache[id] = next;
    } catch (error) {
      cache[id] = {
        id,
        name: SOURCE_INFO[id].name,
        items: old?.items || [],
        updatedAt: old?.updatedAt || 0,
        status: 'error',
        error: readableError(error),
        stale: Boolean(old?.items?.length)
      };
    }
    saveCache();
    if (id === activeSource) render();
  }));
  refreshInProgress = false;
  els.refresh.classList.remove('loading');
  const allFailed = ids.every(id => cache[id]?.status === 'error');
  els.refreshState.textContent = '页面打开时更新';
  render();
  if (manual) showToast(allFailed ? '本次更新未成功，已保留可用缓存' : '刷新完成');
}
function readableError(error) {
  const message = String(error?.message || error || '未知错误');
  if (/Failed to fetch|Load failed|NetworkError/i.test(message)) return '网络或跨域访问受限';
  if (/AbortError|aborted/i.test(message)) return '请求超时';
  return message.slice(0, 80);
}
function render() {
  const source = SOURCE_INFO[activeSource];
  const board = cache[activeSource];
  document.querySelectorAll('.source-tab').forEach(tab => {
    const active = tab.dataset.id === activeSource;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  els.title.textContent = source.name;
  els.eyebrow.textContent = source.eyebrow;
  els.today.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  if (!board) {
    els.count.textContent = '— 条';
    els.status.textContent = '正在获取榜单…';
    els.updated.textContent = '等待数据源响应';
    els.list.replaceChildren();
    els.empty.hidden = true;
    els.retry.hidden = true;
    els.cacheNotice.hidden = true;
    return;
  }
  const items = Array.isArray(board.items) ? board.items : [];
  els.count.textContent = `${items.length} 条`;
  els.updated.textContent = board.updatedAt ? `最近更新 ${timeLabel(board.updatedAt)}` : '等待数据源响应';
  if (board.status === 'error') {
    els.status.textContent = `获取失败：${board.error || '未知错误'}`;
  } else {
    els.status.textContent = `共 ${items.length} 条 · 更新于 ${timeLabel(board.updatedAt)}`;
  }
  els.retry.hidden = board.status !== 'error';
  els.cacheNotice.hidden = !(board.stale && items.length);
  els.empty.hidden = items.length > 0;
  els.list.replaceChildren();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const li = document.createElement('li');
    const showRank = activeSource !== 'history_wiki';
    li.className = showRank ? 'trend-item' : 'trend-item no-rank';
    const rank = document.createElement('span');
    rank.className = 'trend-rank';
    rank.textContent = String(i + 1).padStart(2, '0');
    const content = document.createElement('div');
    content.className = 'trend-main';
    const title = document.createElement('div');
    title.className = 'trend-title';
    title.textContent = item.title;
    if (item.url) {
      const mark = document.createElement('span');
      mark.className = 'trend-link-mark';
      mark.textContent = '↗';
      title.append(mark);
      li.setAttribute('role', 'link');
      li.tabIndex = 0;
      li.addEventListener('click', () => openItem(item.url));
      li.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItem(item.url); }
      });
    }
    content.append(title);
    if (item.hot) {
      const meta = document.createElement('div');
      meta.className = 'trend-meta';
      meta.textContent = item.hot;
      content.append(meta);
    }
    if (showRank) li.append(rank, content); else li.append(content);
    els.list.append(li);
  }
}
function openItem(url) {
  const valid = safeUrl(url);
  if (valid) window.open(valid, '_blank', 'noopener,noreferrer');
}
function selectSource(id) {
  if (!SOURCE_INFO[id]) return;
  activeSource = id;
  render();
  const tab = els.tabs.querySelector(`[data-id="${id}"]`);
  if (tab) tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  const board = cache[id];
  if (!board || Date.now() - (board.updatedAt || 0) > REFRESH_INTERVAL) refreshAll(false);
}
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}
function maybeRefresh() {
  if (document.visibilityState !== 'visible' || refreshInProgress) return;
  const isNewDay = cache._day !== localDayKey();
  const stale = Date.now() - lastRefreshAttempt > REFRESH_INTERVAL;
  if (isNewDay || stale) {
    cache._day = localDayKey();
    saveCache();
    refreshAll(false);
  }
}

els.tabs.addEventListener('click', event => {
  const tab = event.target.closest('.source-tab');
  if (tab) selectSource(tab.dataset.id);
});
els.refresh.addEventListener('click', () => refreshAll(true));
els.retry.addEventListener('click', () => refreshAll(true));
document.addEventListener('visibilitychange', maybeRefresh);
window.addEventListener('pageshow', maybeRefresh);

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

cache._day = cache._day || localDayKey();
render();
if (!Object.keys(SOURCE_INFO).every(id => cache[id]?.items?.length)) refreshAll(false);
else if (Date.now() - Math.max(...Object.keys(SOURCE_INFO).map(id => cache[id]?.updatedAt || 0)) > REFRESH_INTERVAL) refreshAll(false);
setInterval(maybeRefresh, 30 * 1000);
