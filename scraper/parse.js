// Turns raw tables (from extract.js) into structured deposit-rate and FX rows.
// Pure functions, no network: easy to test with saved page snapshots.

const CURRENCIES = {
  HKD: [/港元/, /港幣/, /\bHKD\b/i, /HK\$/i, /Hong ?Kong Dollar/i],
  USD: [/美元/, /美金/, /\bUSD\b/i, /US\$/i, /US Dollar/i],
  CNY: [/人民幣/, /\bRMB\b/i, /\bCNY\b/i, /\bCNH\b/i, /Renminbi/i],
  AUD: [/澳元/, /澳幣/, /\bAUD\b/i, /AU\$/i, /Australian Dollar/i],
  GBP: [/英鎊/, /\bGBP\b/i, /Pound/i, /Sterling/i],
  JPY: [/日圓/, /日元/, /\bJPY\b/i, /Japanese Yen/i, /\bYen\b/i],
};
// Currencies we do NOT track; used to stop a table being mis-assigned.
const OTHER_CCY = /(加拿大元|加元|加幣|泰國銖|新西蘭元|\bCAD\b|紐元|紐西蘭|\bNZD\b|歐羅|歐元|\bEUR\b|瑞士法郎|瑞郎|\bCHF\b|新加坡元|星元|\bSGD\b|泰銖|\bTHB\b|南非|\bZAR\b)/i;

function currenciesIn(text) {
  const found = [];
  for (const [code, pats] of Object.entries(CURRENCIES)) {
    let best = -1;
    for (const p of pats) {
      const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      let m;
      while ((m = re.exec(text))) best = Math.max(best, m.index);
    }
    if (best >= 0) found.push({ code, pos: best });
  }
  return found;
}
// Currency mentioned closest to the END of the text (= nearest to the table).
function lastCurrency(text) {
  const f = currenciesIn(text);
  let other = -1;
  const re = new RegExp(OTHER_CCY.source, 'gi');
  let m;
  while ((m = re.exec(text))) other = Math.max(other, m.index);
  if (!f.length) return other >= 0 ? 'OTHER' : null;
  f.sort((a, b) => b.pos - a.pos);
  if (other > f[0].pos) return 'OTHER';
  return f[0].code;
}
function onlyCurrency(text) {
  const f = currenciesIn(text);
  const re = new RegExp(OTHER_CCY.source, 'i');
  if (re.test(text)) return f.length ? null : 'OTHER';
  return f.length === 1 ? f[0].code : null;
}

// ---- tenors ---------------------------------------------------------------
const CN_NUM = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十二: 12, 十八: 18, 二十四: 24, 三十六: 36 };
function toNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return CN_NUM[s] || null;
}
// Returns tenor in days, or null. Cell must be "mostly" a tenor label.
function parseTenor(cell) {
  if (!cell) return null;
  const t = cell.replace(/\s+/g, '').replace(/存款期|存期|期限|Tenor|Term|定期|:|：/gi, '');
  if (t.length > 14) return null;
  let m;
  if ((m = t.match(/^(\d+|[一二兩三四五六七八九十]+)(?:個)?(日|天|day|days|D)$/i))) {
    const n = toNum(m[1]); return n ? n : null;
  }
  if ((m = t.match(/^(\d+|[一二兩三四五六七八九十]+)(?:個)?(?:星期|週|周|week|weeks|wk|W)$/i))) {
    const n = toNum(m[1]); return n ? n * 7 : null;
  }
  if ((m = t.match(/^(\d+|[一二兩三四五六七八九十]+)(?:個)?(?:月|months?|mths?|M)$/i))) {
    const n = toNum(m[1]); return n ? n * 30 : null;
  }
  if ((m = t.match(/^(\d+|[一二兩三四五六七八九十]+)(?:個)?(?:年|years?|yrs?|Y)$/i))) {
    const n = toNum(m[1]); return n ? n * 360 : null;
  }
  return null;
}
function tenorLabel(days) {
  if (days < 30) return `${days}日`;
  if (days % 360 === 0 && days >= 360) return days === 360 ? '12個月' : `${days / 30}個月`;
  return `${Math.round(days / 30)}個月`;
}

// ---- rates ----------------------------------------------------------------
function parseRate(cell, pctTable) {
  if (!cell) return null;
  let c = cell.replace(/\s+/g, '');
  const pair = c.match(/^\(?(\d{1,2}\.\d{1,6})%?\)?[\/／](\d{1,2}\.\d{1,6})%?\*{0,3}$/);
  if (pair) { const a = parseFloat(pair[1]), b = parseFloat(pair[2]); const v = Math.max(a, b); return v > 0 && v < 20 ? v : null; }
  const paren = c.match(/^\((\d{1,2}\.\d{1,6})\)$/);
  if (paren && pctTable) c = paren[1];
  if (/^(-|—|–|N\/A|不適用|不設|--)$/i.test(c)) return null;
  let m = c.match(/^(?:年利率|最高|高達|Upto|up to)?(\d{1,2}(?:\.\d{1,6})?)%(?:p\.?a\.?|\*+|#|\^|[\[(（]?[a-zA-Z0-9]{0,2}[\])）]?)?$/i);
  if (!m && pctTable) m = c.match(/^(\d{1,2}\.\d{1,6})\*{0,3}$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!(v > 0 && v < 20)) return null;
  return v;
}

// minimum amount from a column header like "港元10,000 至 港元29,999" / "HK$100,000 or above" / "10萬"
function parseMinAmount(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, '');
  let m = t.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(萬|万|億|M|K|百萬|million)?/i);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === '萬' || unit === '万') v *= 1e4;
  else if (unit === '百萬' || unit === 'm' || unit === 'million') v *= 1e6;
  else if (unit === 'k') v *= 1e3;
  else if (unit === '億') v *= 1e8;
  if (/以下|below|less than|under/i.test(t) && !/至|-|to/.test(t)) return 0;
  return v;
}

const STRIP_FOR_SEGMENT = new RegExp(
  [
    ...Object.values(CURRENCIES).flat().map((r) => r.source),
    '\\d[\\d,.]*', '萬', '至', '或以上', '以上', '或', 'to', 'and above', 'or above', 'above',
    '年利率', '利率', '存款額', '存款金額', '金額', 'p\\.a\\.', '%', '\\(', '\\)', '（', '）', '/', '-', '–',
    'Deposit Amount', 'Interest Rate', 'Amount', 'rate', '存款期', 'Tenor',
    '新資金', '特惠', '優惠', '定期存款', '定存', '貨幣', '達(?=\\s*[港美人澳英日HUCAGJ\\d])', '起存', '最低', '每', '筆', 'p\\.a', '\\*', '#', '：', ':',
    'New Funds?', 'Time Deposits?', 'Preferential', 'Promotional', 'Minimum', 'Currency', 'of',
  ].join('|'),
  'gi'
);
function segmentOf(header) {
  const s = (header || '').replace(STRIP_FOR_SEGMENT, ' ').replace(/\s+/g, ' ').trim();
  const letters = (s.match(/[\u4e00-\u9fffA-Za-z]/g) || []).length;
  return letters >= 2 && s.length <= 40 ? s : '';
}

// ---- deposit tables -------------------------------------------------------
function analyseDepositTable(tbl, pageCtx) {
  const grid = tbl.grid;
  const nRows = grid.length;
  const nCols = Math.max(...grid.map((r) => r.length));
  const allText = grid.flat().join(' ');
  const pctTable = /%|年利率|利率|p\.a\./i.test(allText + ' ' + tbl.context);

  // count tenor cells per column and per row
  const colScore = new Array(nCols).fill(0);
  const rowScore = new Array(nRows).fill(0);
  grid.forEach((row, r) => row.forEach((cell, c) => {
    if (parseTenor(cell)) { colScore[c]++; rowScore[r]++; }
  }));
  const bestCol = colScore.indexOf(Math.max(...colScore));
  const bestRow = rowScore.indexOf(Math.max(...rowScore));
  if (Math.max(colScore[bestCol] || 0, rowScore[bestRow] || 0) < 1) return [];

  // orient so tenors run down a column
  let g = grid;
  let tenorCol = bestCol;
  if ((rowScore[bestRow] || 0) > (colScore[bestCol] || 0)) {
    g = [];
    for (let c = 0; c < nCols; c++) g.push(grid.map((row) => row[c] || ''));
    tenorCol = bestRow;
  }
  const rows = g;
  const firstTenorRow = rows.findIndex((row) => parseTenor(row[tenorCol]));
  const headerRows = rows.slice(0, Math.max(firstTenorRow, 0));
  const ctxCcy = lastCurrency(tbl.context) || null;
  const out = [];

  rows.forEach((row, r) => {
    const days = parseTenor(row[tenorCol]);
    if (!days) return;
    // row label cells other than tenor (e.g. currency in first col)
    const rowLabel = row.slice(0, tenorCol).join(' ');
    row.forEach((cell, c) => {
      if (c === tenorCol) return;
      const rate = parseRate(cell, pctTable);
      if (rate == null) return;
      const header = headerRows.map((h) => h[c] || '').filter((x, i, a) => x && a.indexOf(x) === i).join(' ');
      const ccy = onlyCurrency(header) || onlyCurrency(rowLabel) || ctxCcy;
      if (!ccy || ccy === 'OTHER') return;
      out.push({
        currency: ccy,
        tenorDays: days,
        tenor: tenorLabel(days),
        rate,
        minAmount: parseMinAmount(header),
        tierLabel: header.slice(0, 80),
        segment: segmentOf(header) || segmentOf(rowLabel),
        tableIndex: tbl.index,
      });
    });
  });
  return out;
}

const COND_HINTS = [
  [/新資金|new fund|new money/i, '新資金'],
  [/網上|手機|app|online|mobile|電子/i, '網上/手機開立'],
  [/卓越理財尊尚|Premier Elite/i, '卓越理財尊尚'],
  [/卓越理財|Premier/i, '卓越理財'],
  [/優越理財|Prestige/i, '優越理財'],
  [/Priority|優先理財/i, '優先理財'],
  [/豐盛理財|Treasures/i, '豐盛理財'],
  [/Citigold|花旗私人/i, 'Citigold'],
  [/新客戶|新開戶|new customer/i, '新客戶'],
  [/(?:經本行|於本行|透過本行|以外幣|將外幣|現有外幣|指定貨幣)\S{0,6}兌換|兌換\S{0,4}(?:成|為)(?:港元|港幣|指定貨幣|外幣)|兌換(?:外幣|指定貨幣)\S{0,8}(?:定存|定期)|conver(?:t|sion)[^.]{0,30}(?:time deposit|HKD)/i, '需經本行兌換'],
  [/等值年利率|獎賞錢|RewardCash/i, '含獎賞錢等值'],
];
const PREMIUM_TAGS = ['卓越理財尊尚', '卓越理財', '優越理財', '優先理財', '豐盛理財', 'Citigold'];
// Customer-tier tags only from text that labels this specific rate (headers), not from the whole page
function conditionsFrom(text, opts = {}) {
  if (opts.noTier) return conditionsFromRaw(text).filter((t) => !PREMIUM_TAGS.includes(t));
  return conditionsFromRaw(text);
}
function conditionsFromRaw(text) {
  const tags = [];
  for (const [re, tag] of COND_HINTS) if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  // keep Premier Elite from also tagging Premier
  if (tags.includes('卓越理財尊尚')) return tags.filter((t) => t !== '卓越理財');
  return tags;
}

function parseDeposits(page, source) {
  const rows = [];
  for (const tbl of page.tables) {
    const found = analyseDepositTable(tbl, page);
    const ctx = (tbl.context || '');
    // nearby heading text: conditions such as 新資金 / 網上; customer tiers only if right next to the table
    const tags = [...new Set([...conditionsFrom(ctx.slice(-140), { noTier: true }), ...conditionsFrom(ctx.slice(-50))])];
    if (/new-?customer|newcustomer|new_customer|新客/i.test(source.url || '')) tags.push('新客戶');
    for (const f of found) {
      const segTags = conditionsFrom((f.segment || '') + ' ' + (f.tierLabel || ''));
      rows.push({
        ...f,
        type: source.type || 'board',
        conditions: Array.from(new Set([...(source.conditions || []), ...tags, ...segTags])),
        sourceUrl: source.url,
      });
    }
  }
  // keep only currencies we track and dedupe exact duplicates
  const seen = new Set();
  return rows.filter((r) => {
    if (!CURRENCIES[r.currency]) return false;
    if (source.currencies && !source.currencies.includes(r.currency)) return false;
    const k = [r.currency, r.tenorDays, r.rate, r.minAmount, r.segment, r.type].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- FX tables ------------------------------------------------------------
function parseNumber(cell) {
  if (!cell) return null;
  const m = cell.replace(/[\s,]/g, '').match(/^(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function fxColumns(headerText) {
  // returns which kind a header cell is: 'buy' | 'sell' | null, preferring TT over notes
  const h = headerText.replace(/\s+/g, '');
  const notes = /鈔票|現鈔|現金|Notes|Cash|Banknote/i.test(h);
  const buy = /買入|銀行買|BankBuy|Buy|We ?Buy|Bid/i.test(h);
  const sell = /賣出|銀行賣|BankSell|Sell|We ?Sell|Offer|Ask/i.test(h);
  if (buy === sell) return null;
  return { kind: buy ? 'buy' : 'sell', notes };
}
function parseFx(page, mid) {
  const results = {};
  for (const tbl of page.tables) {
    const g = tbl.grid;
    if (g.length < 3) continue;
    // header = first 1-2 rows joined per column
    const nCols = Math.max(...g.map((r) => r.length));
    const headers = [];
    for (let c = 0; c < nCols; c++) headers.push([g[0][c], g[1] && g[1][c]].filter(Boolean).join(' '));
    const cols = headers.map(fxColumns);
    const buyCols = cols.map((x, i) => (x && x.kind === 'buy' ? i : -1)).filter((i) => i >= 0);
    const sellCols = cols.map((x, i) => (x && x.kind === 'sell' ? i : -1)).filter((i) => i >= 0);
    if (!buyCols.length || !sellCols.length) continue;
    const pick = (arr) => arr.find((i) => !cols[i].notes) ?? arr[0];
    const bc = pick(buyCols);
    const sc = pick(sellCols);
    for (const row of g) {
      const label = row.slice(0, Math.min(bc, sc)).join(' ');
      const ccy = onlyCurrency(label);
      if (!ccy || ccy === 'OTHER' || ccy === 'HKD') continue;
      let buy = parseNumber(row[bc]);
      let sell = parseNumber(row[sc]);
      if (!buy || !sell) continue;
      // normalise "per 100 / per 1000 units" or inverse quotes against market mid
      const ref = mid && mid[ccy];
      if (ref) {
        for (const f of [1, 100, 1000, 10000]) {
          const b = buy / f, s = sell / f;
          if (Math.abs((b + s) / 2 / ref - 1) < 0.06) { buy = b; sell = s; break; }
          const ib = 1 / buy * f, is = 1 / sell * f; // quoted as foreign per HKD
          if (Math.abs((ib + is) / 2 / ref - 1) < 0.06) { buy = Math.min(ib, is); sell = Math.max(ib, is); break; }
        }
        if (Math.abs((buy + sell) / 2 / ref - 1) >= 0.06) continue; // still nonsense → skip
      }
      if (buy > sell) [buy, sell] = [sell, buy];
      if (!results[ccy]) results[ccy] = { buy, sell, tt: !cols[bc].notes };
    }
  }
  return results;
}

// "至2026年10月31日" / "until 31 Oct 2026" → validity end date of an offer
function validUntil(text) {
  const t = text || '';
  const re = /(?:至|直至|截至|止|until|till|to)\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/gi;
  let m, best = null;
  while ((m = re.exec(t))) {
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!best || d > best) best = d;
  }
  return best;
}

// ---- text fallback (pages that lay rates out with <div>s instead of <table>) ----
// Looks for a tenor and a % rate on the same line, or a tenor line followed closely
// by a rate line. Currency comes from the line itself or the nearest heading above.
const RATE_IN_TEXT = /(\d{1,2}(?:\.\d{1,4})?)\s*%/g;
const TENOR_IN_TEXT = /(\d{1,2}|[一二兩三六九十]{1,3})\s*(?:個)?\s*(日|天|星期|週|個月|月|年|days?|weeks?|months?|M\b)/gi;
function parseTextRates(text, source) {
  const lines = (text || '').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let ctxCcy = null;
  let ctxLine = -99;
  const push = (ccy, days, rate, i, raw) => {
    if (!ccy || !CURRENCIES[ccy] || !days || days < 7 || days > 1100 || !(rate > 0.01 && rate < 15)) return;
    const near = lines.slice(Math.max(0, i - 4), i + 1).join(' ');
    if (/儲蓄|活期|savings|按揭|貸款|loan|信用卡|回贈|cash ?back|保險|基金|最優惠利率|P\s*[-+]/i.test(near) && !/定期|time deposit/i.test(near)) return;
    out.push({ currency: ccy, tenorDays: days, tenor: tenorLabel(days), rate, minAmount: null, tierLabel: raw.slice(0, 80), segment: '', fromText: true, near });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length <= 40) {
      const c = onlyCurrency(line);
      if (c && c !== 'OTHER') { ctxCcy = c; ctxLine = i; }
      if (c === 'OTHER') { ctxCcy = null; }
    }
    if (line.length > 160) continue;
    const tenors = [...line.matchAll(TENOR_IN_TEXT)].map((m) => parseTenor(m[0])).filter(Boolean);
    const rates = [...line.matchAll(RATE_IN_TEXT)].map((m) => parseFloat(m[1]));
    const own = onlyCurrency(line);
    const ccy = own && own !== 'OTHER' ? own : (i - ctxLine <= 12 ? ctxCcy : null);
    if (own === 'OTHER') continue;
    if (tenors.length === 1 && rates.length >= 1) { push(ccy, tenors[0], Math.max(...rates), i, line); continue; }
    if (tenors.length > 1 && rates.length === tenors.length) { tenors.forEach((d, k) => push(ccy, d, rates[k], i, line)); continue; }
    // tenor alone on its line, rate on one of the next 3 lines
    if (tenors.length === 1 && rates.length === 0 && line.length <= 20) {
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        if ([...lines[j].matchAll(TENOR_IN_TEXT)].length) break;
        const r = [...lines[j].matchAll(RATE_IN_TEXT)].map((m) => parseFloat(m[1]));
        if (r.length === 1 && lines[j].length <= 40) { push(ccy, tenors[0], r[0], j, line + ' ' + lines[j]); break; }
      }
    }
  }
  const seen = new Set();
  return out.filter((r) => {
    const k = r.currency + r.tenorDays + '|' + r.rate;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).map((r) => ({ ...r, type: source.type || 'promo', conditions: conditionsFrom(r.near.slice(-200)), sourceUrl: source.url, near: undefined }));
}
function effectiveDate(text) {
  const m = (text || '').match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const e = (text || '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})/);
  if (e) return `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}`;
  return null;
}

module.exports = { parseTextRates, validUntil, parseDeposits, parseFx, parseTenor, parseRate, parseMinAmount, lastCurrency, effectiveDate, tenorLabel, conditionsFrom };
