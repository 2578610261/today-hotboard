// 在 GitHub Actions 里运行（服务器端抓取，不受浏览器 CORS 限制）。
// 每个来源按顺序尝试多个接口，第一个成功的就写入 data/<id>.json。
// 单个来源失败不会让整个部署失败；日志里会写明每个来源走了哪条路、为什么失败。
import { mkdir, writeFile, appendFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MAX_ITEMS = 40;

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const httpUrl = u => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
function fmtHot(v) {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return clean(v);
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + '万';
  return String(n);
}

async function getJson(url, headers = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', ...headers }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error('返回的不是 JSON：' + text.slice(0, 80).replace(/\s+/g, ' ')); }
  } finally { clearTimeout(timer); }
}

// ---------- 各来源的官方接口 ----------
async function baiduOfficial() {
  const j = await getJson('https://top.baidu.com/api/board?platform=wise&tab=realtime', { Referer: 'https://top.baidu.com/board?tab=realtime' });
  const out = [];
  const walk = node => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.word || node.query) {
      const word = clean(node.word || node.query);
      out.push({ title: word, url: httpUrl(node.url) || httpUrl(node.rawUrl) || `https://www.baidu.com/s?wd=${encodeURIComponent(word)}`, hot: fmtHot(node.hotScore) });
    }
    if (node.topContent) walk(node.topContent);
    if (node.content) walk(node.content);
  };
  walk(j?.data?.cards);
  return out;
}

async function weiboOfficial() {
  const j = await getJson('https://weibo.com/ajax/side/hotSearch', { Referer: 'https://weibo.com/' });
  return (j?.data?.realtime || []).filter(x => !x.is_ad && (x.word || x.note)).map(x => {
    const word = clean(x.word || x.note);
    return { title: word, url: `https://s.weibo.com/weibo?q=${encodeURIComponent('#' + word + '#')}`, hot: fmtHot(x.num) };
  });
}

async function toutiaoOfficial() {
  const j = await getJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', { Referer: 'https://www.toutiao.com/' });
  return (j?.data || []).filter(x => x.Title).map(x => ({
    title: clean(x.Title),
    url: httpUrl(x.Url) || (x.ClusterIdStr ? `https://www.toutiao.com/trending/${x.ClusterIdStr}/` : ''),
    hot: fmtHot(x.HotValue)
  }));
}

async function wallstreetcnOfficial() {
  const j = await getJson('https://api-one.wallstcn.com/apiv1/content/information-flow?channel=global-channel&accept=article&limit=30', { Referer: 'https://wallstreetcn.com/' });
  return (j?.data?.items || [])
    .filter(x => x.resource_type !== 'ad' && x.resource && x.resource.type !== 'live' && x.resource.uri)
    .map(x => {
      const r = x.resource;
      const t = r.display_time ? new Date(r.display_time * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '';
      return { title: clean(r.title || r.content_short), url: httpUrl(r.uri), hot: t };
    });
}

// ---------- 后备：NewsNow 公共接口（服务器端请求，没有 CORS 问题）----------
const newsnow = id => async () => {
  const j = await getJson(`https://newsnow.busiyi.world/api/s?id=${id}`);
  return (j?.items || []).map(x => ({ title: clean(x.title), url: httpUrl(x.url) || httpUrl(x.mobileUrl), hot: clean(x?.extra?.info || x?.extra?.hot || '') }));
};

const SOURCES = {
  baidu: [['官方接口', baiduOfficial], ['NewsNow', newsnow('baidu')]],
  weibo: [['官方接口', weiboOfficial], ['NewsNow', newsnow('weibo')]],
  toutiao: [['官方接口', toutiaoOfficial], ['NewsNow', newsnow('toutiao')]],
  wallstreetcn: [['官方接口', wallstreetcnOfficial], ['NewsNow', newsnow('wallstreetcn')]]
};

await mkdir('data', { recursive: true });
const lines = ['| 来源 | 结果 | 详情 |', '|---|---|---|'];
let okCount = 0;

for (const [id, chain] of Object.entries(SOURCES)) {
  const errors = [];
  let done = false;
  for (const [label, fn] of chain) {
    try {
      const items = (await fn()).filter(x => x.title).slice(0, MAX_ITEMS);
      if (!items.length) throw new Error('解析后为空（接口格式可能变了）');
      await writeFile(`data/${id}.json`, JSON.stringify({ id, via: label, generatedAt: Date.now(), items }));
      lines.push(`| ${id} | ✅ | ${label}，${items.length} 条${errors.length ? '（前面失败：' + errors.join('；') + '）' : ''} |`);
      console.log(`[${id}] OK via ${label}, ${items.length} items`);
      okCount++; done = true; break;
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      console.log(`[${id}] ${label} failed: ${e.message}`);
    }
  }
  if (!done) lines.push(`| ${id} | ❌ | ${errors.join('；')} |`);
}

console.log(`\n${okCount}/${Object.keys(SOURCES).length} 个来源成功`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## 数据抓取结果\n\n${lines.join('\n')}\n`);
