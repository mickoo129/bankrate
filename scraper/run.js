// Main scraper. Runs on GitHub Actions on a schedule.
// 1. Opens each bank's rate pages in a headless browser
// 2. Reads every table and turns it into deposit-rate / FX rows
// 3. Writes public/data/latest.json, history.json and report.json
//
// Usage: node scraper/run.js [--only=hsbc,sc] [--no-discover]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { JSDOM, VirtualConsole } = require('jsdom');
const banks = require('./banks');
const { extractTables } = require('./extract');
const { parseDeposits, parseFx, validUntil, parseTextRates, capAmounts, validUntilNear, contextMins } = require('./parse');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const CURRENCIES = ['HKD', 'USD', 'CNY', 'AUD', 'GBP', 'JPY'];
const MAX_PAGES_PER_BANK = 18;
const CONCURRENCY = 4;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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

// PDF rate sheets: text laid out line by line (items grouped by their y position)
async function loadPdf(context, url) {
  const resp = await context.request.get(url, { timeout: 45000 });
  const status = resp.status();
  const buf = await resp.body();
  if (status >= 400 || buf.slice(0, 5).toString() !== '%PDF-') return { status: status >= 400 ? status : 415, finalUrl: url, data: { title: '', url, text: '', lines: '', tables: [] }, links: [] };
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + '/', cMapPacked: true, standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/' }).promise;
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
    const pg = await doc.getPage(n);
    const tc = await pg.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push([it.transform[4], it.str]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y).sort((a, b) => a[0] - b[0]).map((x) => x[1].trim()).join(' '));
  }
  const lines = out.join('\n');
  return { status, finalUrl: url, data: { title: 'PDF', url, text: lines.replace(/\s+/g, ' '), lines, tables: [], viaPdf: true }, links: [] };
}

// Pages that only show one currency / tab at a time: pick each option or click each tab and read again
async function readVariants(page, opts, data) {
  const add = (fd, label) => {
    const offset = data.tables.length + 2000;
    fd.tables.forEach((t) => { t.index += offset; if (label) t.context = t.context + ' | ' + label; });
    data.tables.push(...fd.tables);
    data.text += ' ' + fd.text;
    data.lines += '\n' + fd.lines;
  };
  if (opts.select) {
    const options = await page.evaluate((sel) => { const s = document.querySelector(sel); return s ? Array.from(s.options).map((o) => [o.value, o.text.trim()]) : []; }, opts.select).catch(() => []);
    for (const [value, label] of options) {
      if (!/港|美|人民|澳|英|日|HKD|USD|CNY|RMB|AUD|GBP|JPY/i.test(label + value)) continue;
      try {
        await page.evaluate(([sel, v]) => { const s = document.querySelector(sel); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }, [opts.select, value]);
        await page.waitForTimeout(2500);
        add(await page.evaluate(extractTables), label);
      } catch {}
    }
  }
  // with tabs, the page's starting state is ambiguous (which tab is showing?), so keep only what each click shows
  const clicked = { tables: [], text: '', lines: '' };
  for (const label of opts.clicks || []) {
    try {
      const ok = await page.evaluate((txt) => {
        document.querySelectorAll('[data-scrape-skip]').forEach((t) => t.removeAttribute('data-scrape-skip'));
        const el = Array.from(document.querySelectorAll('button, a, li, span, div, [role=tab]')).find((e) => e.textContent.trim() === txt && e.offsetParent !== null);
        if (!el) return false;
        el.click();
        // only read the tables that belong with this tab row (pages can have several tab rows, each with its own table)
        let scope = el.parentElement;
        while (scope && !scope.querySelector('table')) scope = scope.parentElement;
        if (scope) document.querySelectorAll('table').forEach((t) => { if (!scope.contains(t)) t.setAttribute('data-scrape-skip', '1'); });
        return true;
      }, label);
      if (!ok) continue;
      await page.waitForTimeout(2500);
      const fd = await page.evaluate(extractTables);
      fd.tables.forEach((t) => { t.index += clicked.tables.length + 3000; t.context = t.context + ' | ' + label; });
      clicked.tables.push(...fd.tables); clicked.text += ' ' + fd.text; clicked.lines += '\n' + fd.lines;
    } catch {}
  }
  if (clicked.tables.length) { data.tables = clicked.tables; data.text += clicked.text; data.lines += clicked.lines; }
}

async function loadPage(context, url, opts = {}) {
  if (opts.pdf || /\.pdf(?:$|\?)/i.test(url)) return loadPdf(context, url);
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
    if (opts.select || opts.clicks) await readVariants(page, opts, data);
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
    // Some sites serve a bot-check page to headless browsers; the plain HTML often still has the tables.
    if (!data.tables.length) {
      try {
        const html = await (await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-HK,zh;q=0.9' }, signal: AbortSignal.timeout(30000) })).text();
        const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
        const raw = extractTables(dom.window.document);
        if (raw.tables.length) { data.tables = raw.tables; data.text += ' ' + raw.text; data.lines += '\n' + raw.lines; data.viaHtml = true; }
        dom.window.close();
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
  // 'auto' pages: each table is promo or board depending on its own title and header
  return parseDeposits(data, { type, url });
}

async function scrapeBank(context, bank, mid, report) {
  const visited = new Set();
  const queue = [];
  for (const p of bank.pages || []) queue.push({ ...p, fixed: true });
  for (const u of bank.fxPages || []) queue.push({ url: u, fx: true, fixed: true });
  for (const u of bank.seeds || []) queue.push({ url: u, seed: true, depth: 0 });

  const deposits = [];
  const debugPages = [];
  let fx = {};
  const sources = new Set();
  let offerEnd = null;

  while (queue.length && visited.size < MAX_PAGES_PER_BANK) {
    const item = queue.shift();
    if (!item.fixed) item.url = canonical(item.url);
    const key = item.url;
    if (visited.has(key)) continue;
    visited.add(key);
    const rep = { bank: bank.id, url: item.url, ok: false };
    report.push(rep);
    try {
      const { status, finalUrl, data, links } = await loadPage(context, item.url, item);
      rep.status = status;
      rep.finalUrl = finalUrl;
      rep.tables = data.tables.length;
      rep.title = (data.title || '').slice(0, 60);
      rep.textLen = (data.text || '').length;
      if (data.viaHtml) rep.mode = 'html';
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
        if (item.conditions) r.conditions = [...new Set([...(r.conditions || []), ...item.conditions])];
        if (r.fromText && r.type === 'promo') { // text-only promo pages: look for the period and minimum next to the rate
          const near = validUntilNear(data.text, (data.text || '').indexOf(r.tierLabel.slice(0, 30)));
          if (near) r.validUntil = near;
          if (r.minAmount == null) { const mn = contextMins(data.text, { strict: true })[r.currency]; if (mn != null) { r.minAmount = mn; r.minFrom = 'page'; } }
        }
      });
      const caps = capAmounts(data.text);
      for (const r of rows) if (r.type === 'promo' && caps[r.currency] && !(r.minAmount > caps[r.currency])) r.maxAmount = caps[r.currency];
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
      // keep what was read, so every number can be traced back to its table
      debugPages.push({ url: finalUrl, type, title: data.title, text: (data.text || '').slice(0, 6000), lines: data.viaPdf ? String(data.lines).slice(0, 12000) : undefined, tables: data.tables.map((t) => ({ i: t.index, ctx: t.context.slice(-240), grid: t.grid.slice(0, 40).map((r) => r.slice(0, 12).map((c) => c.slice(0, 60))) })), textRows: rep.mode === 'text' ? rows.length : 0 });
      rep.fx = Object.keys(f);
      rep.ok = true;
      rep.sample = summarise(rows);
      if (rows.length) { deposits.push(...rows); sources.add(finalUrl); }
      if (Object.keys(f).length) { fx = { ...f, ...fx }; sources.add(finalUrl); }
      if (end && rows.some((r) => r.type === 'promo')) offerEnd = offerEnd || end;
      if (item.followPdf) {
        const want = new RegExp(item.followPdf);
        for (const l of links) if (l.href && /\.pdf(?:$|\?)/i.test(l.href) && want.test(l.text)) queue.unshift({ url: l.href, type: item.type, pdf: true, fixed: true });
      }
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
    minAmount: r.minAmount, minFrom: r.minFrom || null, maxAmount: r.maxAmount || null, type: r.type, conditions: r.conditions, segment: r.segment,
    tier: r.tierLabel, validUntil: r.validUntil || null, url: r.sourceUrl,
  }));
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'debug'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'debug', bank.id + '.json'), JSON.stringify(debugPages));
  } catch {}
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
    // record only what an ordinary customer can get: no convert-and-deposit offers, no premium-only
    // tiers, no "up to" headline rates, and a minimum of HKD 100,000 (or equivalent) or less
    const PREMIUM = /卓越|尊尚|優越|豐盛|Citigold|優先理財|財富|VIP|私人|貴賓|顯卓|至尊|理財金|高級理財/;
    const best = {};
    for (const r of b.deposits) {
      const c = r.conditions || [];
      if (c.includes('需經本行兌換') || c.includes('最高息（視乎條件）')) continue;
      if (PREMIUM.test(c.join(' ') + ' ' + (r.segment || '') + ' ' + (r.tier || ''))) continue;
      const hkd = r.currency === 'HKD' ? r.minAmount : r.minAmount * ((latest.mid && latest.mid.rates[r.currency]) || 8);
      if (r.minAmount && hkd > 100000) continue;
      if (r.validUntil && r.validUntil < day) continue;
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
    userAgent: UA,
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
      const base = { id: b.id, name: b.name, nameEn: b.nameEn, group: b.group, site: b.site, promoUrl: b.promoUrl || null };
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
