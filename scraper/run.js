// Main scraper. Runs on GitHub Actions on a schedule.
// 1. Opens each bank's rate pages in a headless browser
// 2. Reads every table and turns it into deposit-rate / FX rows
// 3. Writes public/data/latest.json, history.json and report.json
//
// Usage: node scraper/run.js [--only=hsbc,sc] [--no-discover]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const banks = require('./banks');
const { extractTables } = require('./extract');
const { parseDeposits, parseFx, validUntil, parseTextRates } = require('./parse');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const CURRENCIES = ['HKD', 'USD', 'CNY', 'AUD', 'GBP', 'JPY'];
const MAX_PAGES_PER_BANK = 18;
const CONCURRENCY = 4;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const LINK_WANT = /定期|定存|time-?deposit|timedeposit|存款利率|deposit-?rate|deposit-?interest|利率|interest-?rate|board-?rate|匯率|exchange-?rate|fx-?rate|currency-?rate|外幣|foreign-?currency|rates/i;
const LINK_AVOID = /business|commercial|corporate|\bsme\b|商業|企業|工商|\.pdf|login|logon|apply|form|careers|insurance|mortgage|按揭|loan|貸款|credit-?card|信用卡|invest|fund|基金|stock|股票|career|news|press|investor|privacy|terms|javascript:|mailto:|tel:/i;
const PROMO_HINT = /優惠|特惠|推廣|新資金|promotion|offer|preferential|special|campaign/i;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function hkNow() {
  return new Date().toISOString();
}
function hkDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
}
function sameSite(url, site) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const s = new URL(site).hostname.replace(/^www\./, '');
    return h === s || h.endsWith('.' + s);
  } catch { return false; }
}

async function getMid() {
  // Market mid rates: HKD per 1 unit of foreign currency
  const sources = [
    async () => {
      const r = await fetch('https://open.er-api.com/v6/latest/HKD');
      const j = await r.json();
      return { rates: Object.fromEntries(CURRENCIES.filter((c) => c !== 'HKD').map((c) => [c, 1 / j.rates[c]])), asOf: j.time_last_update_utc, source: 'open.er-api.com' };
    },
    async () => {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=HKD');
      const j = await r.json();
      return { rates: Object.fromEntries(CURRENCIES.filter((c) => c !== 'HKD').map((c) => [c, 1 / j.rates[c]])), asOf: j.date, source: 'frankfurter.dev' };
    },
  ];
  for (const s of sources) {
    try { const m = await s(); if (m.rates.USD > 7 && m.rates.USD < 8.5) return m; } catch (e) { console.warn('mid source failed', e.message); }
  }
  return null;
}

async function loadPage(context, url) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = resp ? resp.status() : 0;
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch {}
    // scroll to trigger lazy-loaded sections
    try {
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight && y < 30000; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1500);
    } catch {}
    const data = await page.evaluate(extractTables);
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const fu = frame.url();
      if (!/^https?:/.test(fu) || /google|facebook|doubleclick|youtube|livechat|lpsnmedia|optimizely|recaptcha/i.test(fu)) continue;
      try {
        const fd = await frame.evaluate(extractTables);
        const offset = data.tables.length + 1000;
        fd.tables.forEach((t) => { t.index += offset; t.context = '[IFRAME] ' + t.context; });
        data.tables.push(...fd.tables);
        data.text += ' ' + fd.text;
        data.lines += '\n' + fd.lines;
      } catch {}
    }
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => ({ href: a.href.split('#')[0], text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) })));
    return { status, finalUrl: page.url(), data, links };
  } finally {
    await page.close().catch(() => {});
  }
}

function guessType(pageCfgType, data) {
  if (pageCfgType) return pageCfgType;
  return PROMO_HINT.test((data.title || '') + ' ' + (data.url || '')) ? 'promo' : 'auto';
}

function rowsFromPage(data, type, url) {
  if (type !== 'auto') return parseDeposits(data, { type, url });
  // decide per table: promo if the table's surrounding text mentions an offer
  const out = [];
  for (const t of data.tables) {
    const tp = PROMO_HINT.test(t.context.slice(-250)) ? 'promo' : 'board';
    out.push(...parseDeposits({ ...data, tables: [t] }, { type: tp, url }));
  }
  return out;
}

async function scrapeBank(context, bank, mid, report) {
  const visited = new Set();
  const queue = [];
  for (const p of bank.pages || []) queue.push({ url: p.url, type: p.type, fixed: true });
  for (const u of bank.fxPages || []) queue.push({ url: u, fx: true, fixed: true });
  for (const u of bank.seeds || []) queue.push({ url: u, seed: true, depth: 0 });

  const deposits = [];
  let fx = {};
  const sources = new Set();
  let offerEnd = null;

  while (queue.length && visited.size < MAX_PAGES_PER_BANK) {
    const item = queue.shift();
    item.url = canonical(item.url);
    const key = item.url;
    if (visited.has(key)) continue;
    visited.add(key);
    const rep = { bank: bank.id, url: item.url, ok: false };
    report.push(rep);
    try {
      const { status, finalUrl, data, links } = await loadPage(context, item.url);
      rep.status = status;
      rep.finalUrl = finalUrl;
      rep.tables = data.tables.length;
      if (status >= 400) { rep.error = 'HTTP ' + status; continue; }
      const type = guessType(item.type, data);
      let rows = rowsFromPage(data, type, finalUrl).filter((r) => r.tenorDays >= 7 && r.tenorDays <= 1100 && r.rate < 20);
      if (!rows.length && /定期|定存|time deposit/i.test(data.text)) {
        rows = parseTextRates(data.lines, { type: type === 'board' ? 'board' : 'promo', url: finalUrl });
        if (rows.length) rep.mode = 'text';
      }
      if (!rows.length && data.tables.length) {
        rep.debug = data.tables.slice(0, 3).map((t) => t.context.slice(-60) + ' ## ' + t.grid.slice(0, 3).map((r) => r.slice(0, 5).join(' / ')).join(' || ').slice(0, 220));
      }
      const end = validUntil(data.text);
      const today = hkDate();
      rows.forEach((r) => {
        if (r.type === 'board') r.conditions = conditionsOnlyFromSegment(r);
        if (r.type === 'promo' && end) r.validUntil = end;
      });
      const before = rows.length;
      const longAgo = hkDate(new Date(Date.now() - 180 * 864e5));
      for (let k = rows.length - 1; k >= 0; k--) {
        const v = rows[k].validUntil;
        if (v && v < longAgo) { rows[k].validUntil = null; continue; } // boilerplate date, ignore
        if (v && v < today) rows.splice(k, 1);
      }
      if (before && !rows.length) rep.note = 'offer expired ' + end;
      const f = mid ? parseFx(data, mid.rates) : {};
      rep.rows = rows.length;
      rep.fx = Object.keys(f);
      rep.ok = true;
      rep.sample = summarise(rows);
      if (rows.length) { deposits.push(...rows); sources.add(finalUrl); }
      if (Object.keys(f).length) { fx = { ...f, ...fx }; sources.add(finalUrl); }
      if (end && rows.some((r) => r.type === 'promo')) offerEnd = offerEnd || end;
      // discovery: follow promising links from seed pages (and from fixed pages too)
      const depth = item.depth ?? 0;
      const strong = /定期|定存|time-?deposit|存款利率|deposit-?rate|board-?rate|匯率|exchange-?rate/i;
      if ((item.seed || item.fixed || (item.discovered && depth < 2)) && !args['no-discover']) {
        for (const l of links) {
          if (!l.href || !sameSite(l.href, bank.site)) continue;
          const hay = l.href + ' ' + l.text;
          if (!LINK_WANT.test(hay) || LINK_AVOID.test(hay)) continue;
          if (VARIANT.test(l.href) || looksArchived(l.href)) continue; // prefer current Traditional Chinese pages
          if (bank.exclude && new RegExp(bank.exclude, 'i').test(l.href)) continue;
          if (item.discovered && !strong.test(hay)) continue; // second hop: only clearly relevant links
          const next = { url: canonical(l.href), discovered: true, depth: depth + 1 };
          if (strong.test(hay)) queue.unshift(next); else queue.push(next);
        }
      }
    } catch (e) {
      rep.error = String(e.message || e).slice(0, 200);
    }
  }

  // de-duplicate rows across pages
  const seen = new Set();
  const uniq = deposits.filter((r) => {
    const k = [r.currency, r.tenorDays, r.rate, r.minAmount, r.type, (r.conditions || []).join(','), r.segment].join('|');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).map((r) => ({
    currency: r.currency, tenorDays: r.tenorDays, tenor: r.tenor, rate: r.rate,
    minAmount: r.minAmount, type: r.type, conditions: r.conditions, segment: r.segment,
    tier: r.tierLabel, validUntil: r.validUntil || null, url: r.sourceUrl,
  }));
  return { deposits: uniq, fx, sources: Array.from(sources), offerEnd };
}

function conditionsOnlyFromSegment(r) {
  const { conditionsFrom } = require('./parse');
  return conditionsFrom((r.segment || '') + ' ' + (r.tierLabel || ''));
}
// strip tracking parameters so the same page is not visited twice
function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of Array.from(u.searchParams.keys())) if (/^(cmpid|pid|intcid|utm_|icid|cid|ref|source)/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
}
// pages whose URL carries a date older than ~10 months are archived offers
function looksArchived(url) {
  const m = url.match(/(20[12]\d)[\/_-]?([01]\d)[\/_-]?([0-3]\d)/);
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(t) && Date.now() - t > 300 * 864e5;
}
const VARIANT = /zh-cn|zh_cn|\/sc\/|_sc\/|hongkong_sc|simplified|\/en\/|\/en-hk\/|\/eng\/|english|lang=en|\/hongkong\/|\/en_/i;

function summarise(rows) {
  const best = {};
  for (const r of rows) {
    const k = `${r.currency} ${r.tenor}${r.type === 'promo' ? '*' : ''}`;
    best[k] = Math.max(best[k] || 0, r.rate);
  }
  return Object.entries(best).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(', ');
}

function updateHistory(history, latest) {
  const day = hkDate();
  history.series = history.series || {};
  const put = (key, rate) => {
    const s = (history.series[key] = history.series[key] || []);
    const last = s[s.length - 1];
    if (last && last[0] === day) last[1] = rate;
    else s.push([day, rate]);
    if (s.length > 800) s.splice(0, s.length - 800);
  };
  const market = {};
  for (const b of latest.banks) {
    if (b.status !== 'ok') continue;
    const best = {};
    for (const r of b.deposits) {
      const k = `${r.currency}|${r.tenorDays}`;
      best[k] = Math.max(best[k] || 0, r.rate);
    }
    for (const [k, v] of Object.entries(best)) {
      put(`${b.id}|${k}`, v);
      market[k] = Math.max(market[k] || 0, v);
    }
  }
  for (const [k, v] of Object.entries(market)) put(`ALL|${k}`, v);
  for (const [c, v] of Object.entries(latest.mid?.rates || {})) put(`FX|${c}`, +v.toFixed(5));
  history.updatedAt = latest.updatedAt;
  return history;
}

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const prev = readJson(path.join(DATA_DIR, 'latest.json'), { banks: [] });
  const prevById = Object.fromEntries((prev.banks || []).map((b) => [b.id, b]));
  const only = args.only ? String(args.only).split(',') : null;
  const list = banks.filter((b) => !only || only.includes(b.id));

  const mid = await getMid();
  console.log('mid', mid);

  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'zh-HK',
    timezoneId: 'Asia/Hong_Kong',
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.6' },
  });
  await context.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });

  const report = [];
  const results = {};
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const bank = list[i++];
      const t0 = Date.now();
      try {
        results[bank.id] = await scrapeBank(context, bank, mid, report);
      } catch (e) {
        results[bank.id] = { deposits: [], fx: {}, sources: [], error: String(e.message || e) };
      }
      console.log(`${bank.id}: ${results[bank.id].deposits.length} rates, fx ${Object.keys(results[bank.id].fx).join('/') || '-'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  const now = hkNow();
  const out = {
    updatedAt: now,
    mid,
    banks: banks.map((b) => {
      const r = results[b.id];
      const old = prevById[b.id];
      const base = { id: b.id, name: b.name, nameEn: b.nameEn, group: b.group, site: b.site };
      if (r && r.deposits.length) {
        return {
          ...base, status: 'ok', lastSuccess: now, checkedAt: now,
          deposits: r.deposits, sources: r.sources, offerEnd: r.offerEnd || null,
          fx: Object.keys(r.fx).length ? r.fx : (old && old.fx) || {},
          fxAt: Object.keys(r.fx).length ? now : (old && old.fxAt) || null,
        };
      }
      // not scraped this run (filtered) or failed: keep previous data, mark stale
      if (old && old.deposits && old.deposits.length) {
        return { ...old, ...base, status: r ? 'stale' : old.status, checkedAt: r ? now : old.checkedAt };
      }
      return { ...base, status: 'none', checkedAt: now, deposits: [], sources: [], fx: (r && r.fx) || {}, fxAt: r && Object.keys(r.fx || {}).length ? now : null };
    }),
  };

  fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify(out));
  const history = updateHistory(readJson(path.join(DATA_DIR, 'history.json'), {}), out);
  fs.writeFileSync(path.join(DATA_DIR, 'history.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(DATA_DIR, 'report.json'), JSON.stringify({ at: now, pages: report }, null, 1));

  const ok = out.banks.filter((b) => b.status === 'ok').length;
  console.log(`\nDONE: ${ok}/${out.banks.length} banks with fresh data`);
  for (const r of report) console.log(`${r.ok ? (r.rows ? '✔' : '·') : '✘'} ${r.bank.padEnd(10)} rows=${r.rows ?? '-'} fx=${(r.fx || []).join('/')} ${r.error || ''} ${r.finalUrl || r.url}${r.sample ? '\n      ' + r.sample : ''}`);
})();
