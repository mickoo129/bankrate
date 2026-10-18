// Turns raw tables (from extract.js) into structured deposit-rate and FX rows.
// Pure functions, no network: easy to test with saved page snapshots.

const CURRENCIES = {
  HKD: [/港元/, /港幣/, /(?<![A-Za-z])HKD(?![A-Za-z])/i, /HK\$/i, /Hong ?Kong Dollar/i],
  USD: [/美元/, /美金/, /(?<![A-Za-z])USD(?![A-Za-z])/i, /US\$/i, /US Dollar/i],
  CNY: [/人民幣/, /(?<![A-Za-z])RMB(?![A-Za-z])/i, /(?<![A-Za-z])CNY(?![A-Za-z])/i, /(?<![A-Za-z])CNH(?![A-Za-z])/i, /Renminbi/i],
  AUD: [/澳元/, /澳幣/, /澳洲元/, /(?<![A-Za-z])AUD(?![A-Za-z])/i, /AU\$/i, /Australian Dollar/i],
  GBP: [/英鎊/, /(?<![A-Za-z])GBP(?![A-Za-z])/i, /Pound/i, /Sterling/i],
  JPY: [/日圓/, /日元/, /(?<![A-Za-z])JPY(?![A-Za-z])/i, /Japanese Yen/i, /\bYen\b/i],
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

// all tracked currencies named in a short label such as "港元 / 人民幣"
function currencyList(text) {
  if (!text || text.length > 60) return [];
  return currenciesIn(text).sort((a, b) => a.pos - b.pos).map((f) => f.code);
}
const CCY_WORD = '(港元|港幣|美元|美金|人民幣|澳洲元|澳元|英鎊|日圓|日元|HKD|USD|RMB|CNY|AUD|GBP|JPY)';
const CCY_MAP = { 港元: 'HKD', 港幣: 'HKD', HKD: 'HKD', 美元: 'USD', 美金: 'USD', USD: 'USD', 人民幣: 'CNY', RMB: 'CNY', CNY: 'CNY', 澳元: 'AUD', 澳洲元: 'AUD', AUD: 'AUD', 英鎊: 'GBP', GBP: 'GBP', 日圓: 'JPY', 日元: 'JPY', JPY: 'JPY' };
// "最低存款金額：2,000美元" → USD. The deposit amount names the table's currency more reliably
// than any other currency word nearby (e.g. "每1獎賞錢價值港幣1元").
function amountCurrency(text) {
  const re = new RegExp(`(?:最低存款金額|存款金額|最低存款額|存款額|最低存款|起存|新資金達?|Minimum deposit)[：:\\s]*(?:${CCY_WORD}\\s*[\\d,]+|[\\d,]+\\s*(?:元)?\\s*${CCY_WORD})`, 'gi');
  let m, last = null;
  while ((m = re.exec(text || ''))) last = CCY_MAP[(m[1] || m[2] || '').toUpperCase()] || CCY_MAP[m[1] || m[2]];
  return last;
}
// Minimum deposit written as a sentence near the table, e.g. "最低存款金額：港幣10,000元或以上",
// "(原幣2,000或以上 /港元10,000或以上)", "不少於500,000港元及/或65,000美元", "只需HKD1".
// Returns { HKD: 10000, USD: 2000, FOREIGN: 2000 } (FOREIGN = "原幣/其他外幣", for non-HKD).
function contextMins(text, { loose = false, strict = false } = {}) {
  const out = {};
  const t = (text || '').replace(/\s+/g, ' ');
  const CW = CCY_WORD.replace('(', '(?:') + '|原幣|其他外幣|HK\\$|US\\$';
  const pairRe = () => new RegExp(`(${CW})\\s*([\\d,]+(?:\\.\\d+)?)\\s*(萬)?|([\\d,]+(?:\\.\\d+)?)\\s*(萬)?\\s*元?\\s*(${CW})`, 'gi');
  const add = (word, num, wan, after) => {
    const code = /HK\$/i.test(word) ? 'HKD' : /US\$/i.test(word) ? 'USD' : /原幣|其他外幣/.test(word) ? 'FOREIGN' : (CCY_MAP[word.toUpperCase()] || CCY_MAP[word]);
    let v = parseFloat(String(num).replace(/,/g, ''));
    if (wan) v *= 1e4;
    if (!code || !(v >= 1) || v > 1e8) return;
    if (/^\s*(?:元)?\s*(?:以下|below)/.test(after)) return; // "…以下" is an upper bound
    if (out[code] == null || v < out[code]) out[code] = v;
  };
  const trig = strict
    ? /(最低存款金額|最低存款額|最低存款|起存金額|起存額|起存|只需|Minimum deposit)/gi
    : /(最低存款金額|最低存款額|最低存款|最低金額|起存金額|起存額|起存|新資金達|存款額|存款金額|不少於|最少|至少|只需|低至|Minimum deposit|minimum of)/gi;
  let m;
  while ((m = trig.exec(t))) {
    const win = t.slice(m.index, m.index + 60);
    const re = pairRe(); let q, lastEnd = -1;
    // first amount after the trigger, plus any listed right after it ("港元10,000/人民幣10,000/其他外幣2,000")
    while ((q = re.exec(win))) {
      if (lastEnd >= 0 && !/^[\s\/／及或、和,，（(）)\u5143以上]*$/.test(win.slice(lastEnd, q.index))) break;
      add(q[1] || q[6], q[2] || q[4], q[3] || q[5], win.slice(q.index + q[0].length, q.index + q[0].length + 4));
      lastEnd = q.index + q[0].length;
    }
  }
  if (loose) { // "(原幣2,000或以上 /港元10,000或以上)" right next to a deposit table
    const re = new RegExp(`(?:(${CW})\\s*([\\d,]+)\\s*(萬)?|([\\d,]+)\\s*(萬)?\\s*元?\\s*(${CW}))\\s*元?\\s*或以上`, 'gi'); let q;
    while ((q = re.exec(t))) add(q[1] || q[6], q[2] || q[4], q[3] || q[5], '');
  }
  return out;
}

// every "currency + amount" pair in a header such as "港元 1,000,000 / 美元128,000 / 澳元100,000"
function amountPairs(text) {
  const out = {};
  const CW = CCY_WORD.replace('(', '(?:') + '|HK\\$|US\\$';
  const re = new RegExp(`(${CW})\\s*([\\d,]+(?:\\.\\d+)?)\\s*(萬)?|([\\d,]+(?:\\.\\d+)?)\\s*(萬)?\\s*元?\\s*(${CW})`, 'gi');
  let q;
  while ((q = re.exec(text || ''))) {
    const word = q[1] || q[6];
    const code = /HK\$/i.test(word) ? 'HKD' : /US\$/i.test(word) ? 'USD' : (CCY_MAP[word.toUpperCase()] || CCY_MAP[word]);
    let v = parseFloat(String(q[2] || q[4]).replace(/,/g, '')); if (q[3] || q[5]) v *= 1e4;
    if (code && v >= 100 && out[code] == null) out[code] = v;
  }
  return out;
}

// the text right above a table (its title / caption), not the whole page section
function lastSegments(ctx) {
  const parts = (ctx || '').split(' | ').map((x) => x.trim()).filter(Boolean);
  let out = parts.pop() || '';
  while (parts.length && out.replace(/\[CAPTION\]|\[TAB\]|\[IFRAME\]/g, '').trim().length < 14) out = parts.pop() + ' | ' + out;
  // captions belong to the table: also include the segment before a caption
  if (/^\[CAPTION\]/.test(out) && parts.length) out = parts.pop() + ' | ' + out;
  return out;
}
const SAVINGS = /活期|儲蓄(?:存款)?年利率|儲蓄戶口|savings? account|savings? rate/i;

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
function tenorsOf(cell) {
  const one = parseTenor(cell);
  if (one) return [one];
  const m = (cell || '').replace(/\s+/g, '').match(/^(\d{1,2})[\/／、及和,](\d{1,2})(?:個)?(月|日|天)$/);
  if (!m) return [];
  const k = m[3] === '月' ? 30 : 1;
  return [parseInt(m[1], 10) * k, parseInt(m[2], 10) * k];
}
function tenorLabel(days) {
  if (days < 30) return `${days}日`;
  if (days % 360 === 0 && days >= 360) return days === 360 ? '12個月' : `${days / 30}個月`;
  return `${Math.round(days / 30)}個月`;
}

// ---- rates ----------------------------------------------------------------
function parseRate(cell, pctTable) {
  if (!cell) return null;
  let c = cell.replace(/\s+/g, '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹†‡§¶]+$/, '');
  const pair = c.match(/^\(?(\d{1,2}\.\d{1,6})%?\)?[\/／](\d{1,2}\.\d{1,6})%?\*{0,3}$/);
  if (pair) { const a = parseFloat(pair[1]), b = parseFloat(pair[2]); const v = Math.max(a, b); return v > 0 && v < 20 ? v : null; }
  const paren = c.match(/^\((\d{1,2}\.\d{1,6})\)$/);
  if (paren && pctTable) c = paren[1];
  if (/^(-|—|–|N\/A|不適用|不設|--)$/i.test(c)) return null;
  // two rates side by side in one cell, e.g. branch / app columns: "0.00100 0.00100" or glued "0.001000.00100"
  const two = cell.trim().match(/^(\d{1,2}\.\d{2,6})%?\s+(\d{1,2}\.\d{2,6})%?$/);
  if (two && pctTable) c = two[1];
  for (let n = 6; n >= 3 && !two; n--) { const g = c.match(new RegExp(`^(\\d\\.\\d{${n}})(\\d\\.\\d{${n}})$`)); if (g && pctTable) { c = g[1]; break; } }
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
  // dates and times ("更新時間:2026/10/18 12:42") are not amounts
  const t = text.replace(/\d{4}\s*[\/\-年.]\s*\d{1,2}\s*[\/\-月.]\s*\d{1,2}\s*日?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?/g, ' ').replace(/\s+/g, '');
  let m = t.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(萬|万|億|M|K|百萬|million)?/i);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === '萬' || unit === '万') v *= 1e4;
  else if (unit === '百萬' || unit === 'm' || unit === 'million') v *= 1e6;
  else if (unit === 'k') v *= 1e3;
  else if (unit === '億') v *= 1e8;
  if (/以下|below|less than|under/i.test(t) && !/至|-|to/.test(t)) return 0;
  return v >= 100 ? v : null;
}

const STRIP_FOR_SEGMENT = new RegExp(
  [
    ...Object.values(CURRENCIES).flat().map((r) => r.source),
    '\\d[\\d,.]*', '萬', '至', '或以上', '以上', '或', 'to', 'and above', 'or above', 'above',
    '年利率', '利率', '存款額', '存款金額', '金額', 'p\\.a\\.', '%', '\\(', '\\)', '（', '）', '/', '-', '–',
    'Deposit Amount', 'Interest Rate', 'Amount', 'rate', '存款期', 'Tenor',
    '新資金', '特惠', '優惠', '定期存款', '定存', '貨幣', '達(?=\\s*[港美人澳英日HUCAGJ\\d])', '起存', '最低', '每', '筆', 'p\\.a', '\\*', '#', '：', ':',
    'New Funds?', 'Time Deposits?', 'Preferential', 'Promotional', 'Minimum', 'Currency', 'of',
    '以下', '少於', '存款期', '銀行服務', '元',
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
  const pctTable = /%|年利率|利率|p\.a\./i.test(allText + ' ' + tbl.context) || !!(pageCtx && pageCtx.pct);

  // count tenor cells per column and per row
  const colScore = new Array(nCols).fill(0);
  const rowScore = new Array(nRows).fill(0);
  grid.forEach((row, r) => row.forEach((cell, c) => {
    if (tenorsOf(cell).length) { colScore[c]++; rowScore[r]++; }
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
  const firstTenorRow = rows.findIndex((row) => tenorsOf(row[tenorCol]).length);
  const headerRows = rows.slice(0, Math.max(firstTenorRow, 0));
  const near = lastSegments(tbl.context);
  const gridOnly = onlyCurrency(allText);
  // a table titled for a currency we don't track ("紐西蘭元定期存款利率") must not inherit one from the table before
  if (onlyCurrency([...new Set(grid[0] || [])].join(' ')) === 'OTHER') return [];
  const ctxCcy = amountCurrency(near) || lastCurrency(near) || lastCurrency(tbl.context) || (pageCtx && pageCtx.prevCcy) || (gridOnly !== 'OTHER' && gridOnly) || null;
  const out = [];
  // a caption like "定期存款（雲利率）" marks online-only rates
  const capOnline = /\[CAPTION\][^|]*(雲利率|網上利率|手機利率|電子渠道)[^|]*$/.test(tbl.context || '');

  rows.forEach((row, r) => {
    for (const days of tenorsOf(row[tenorCol])) addRow(row, days);
  });
  function addRow(row, days) {
    // row label cells other than tenor (e.g. currency in first col)
    const rowLabel = row.filter((x, k) => k !== tenorCol && parseRate(x, pctTable) == null && !tenorsOf(x).length).filter((x, k, a) => a.indexOf(x) === k).join(' ');
    row.forEach((cell, c) => {
      if (c === tenorCol) return;
      const rate = parseRate(cell, pctTable);
      if (rate == null) return;
      const header = headerRows.map((h) => h[c] || '').filter((x, i, a) => x && a.indexOf(x) === i).join(' ');
      // amounts such as "HK$50,000" name the currency of the minimum, not the deposit
      const rowNoAmt = rowLabel.replace(/(?:HK\$|US\$|港元|港幣|美元|人民幣|HKD|USD|RMB)\s*[\d,]+(?:\.\d+)?|[\d,]+\s*(?:港元|港幣|美元|HKD|USD)/gi, ' ');
      const one = onlyCurrency(header) || onlyCurrency(rowNoAmt) || (rowNoAmt.trim() === rowLabel.trim() ? null : onlyCurrency(rowLabel));
      let ccys = one && one !== 'OTHER' ? [one] : [];
      if (!one) ccys = currencyList(rowNoAmt).length ? currencyList(rowNoAmt) : currencyList(header);
      if (!ccys.length && !one && ctxCcy && ctxCcy !== 'OTHER') ccys = [ctxCcy];
      for (const ccy of ccys) out.push({
        currency: ccy,
        tenorDays: days,
        tenor: tenorLabel(days),
        rate,
        minAmount: parseMinAmount(header) ?? parseMinAmount(rowLabel),
        tierLabel: [header, rowLabel].filter(Boolean).join(' ').slice(0, 100),
        segment: [...new Set([segmentOf(header), segmentOf(rowLabel), capOnline ? '網上利率' : ''].filter(Boolean))].join(' ').slice(0, 40),
        tableIndex: tbl.index,
        upTo: /高達|最高|up to/i.test(cell),
      });
    });
  }
  return out;
}

const COND_HINTS = [
  [/新資金|new fund|new money/i, '新資金'],
  [/網上|手機|流動(?:理財|銀行)|雲利率|e-?Banking|mobile app|online banking/i, '網上/手機開立'],
  [/卓越理財尊尚|Premier Elite/i, '卓越理財尊尚'],
  [/卓越理財|Premier/i, '卓越理財'],
  [/優越理財|Prestige/i, '優越理財'],
  [/Priority|優先理財/i, '優先理財'],
  [/豐盛理財|Treasures/i, '豐盛理財'],
  [/Citigold|花旗私人/i, 'Citigold'],
  [/新客戶|新開戶|全新.{0,10}客戶|new customer/i, '新客戶'],
  [/私人財富|中銀理財|工銀財富|理財金|貴賓理財|貴賓|VIP|顯卓|至尊理財|優越私人|私人銀行|Private Wealth/i, '高級理財客戶'],
  [/(?:經本行|於本行|透過本行|以外幣|將外幣|現有外幣|指定貨幣)\S{0,6}兌換|兌換\S{0,4}(?:成|為)(?:港元|港幣|指定貨幣|外幣)|兌換(?:外幣|指定貨幣)\S{0,8}(?:定存|定期)|conver(?:t|sion)[^.]{0,30}(?:time deposit|HKD)/i, '需經本行兌換'],
  [/[（(]外幣兌換[)）]|外幣兌換(?:及)?定期|兌換及定期|兌換\S{0,6}(?:並|再|同時)\S{0,8}(?:開立|設立)/, '需經本行兌換'],
  [/等值年利率|獎賞錢|RewardCash/i, '含獎賞錢等值'],
];
const PREMIUM_TAGS = ['卓越理財尊尚', '卓越理財', '優越理財', '優先理財', '豐盛理財', 'Citigold', '高級理財客戶'];
// Customer-tier tags only from text that labels this specific rate (headers), not from the whole page
function conditionsFrom(text, opts = {}) {
  if (opts.noTier) return conditionsFromRaw(text).filter((t) => !PREMIUM_TAGS.includes(t));
  return conditionsFromRaw(text);
}
function conditionsFromRaw(text) {
  // ignore risk warnings ("將外幣兌換為其他貨幣…蒙受本金損失") and download buttons
  text = (text || '').replace(/[^。|]*(?:風險|蒙受|本金損失|自由兌換|匯率波動|risk)[^。|]*。?/gi, ' ');
  const tags = [];
  for (const [re, tag] of COND_HINTS) if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  // "不論新舊資金" / "新資金／現有資金": not a new-funds-only offer
  if (/不論新舊資金|新舊資金|不論.{0,4}資金|新資金\s*[／\/及或]\s*現有資金|現有資金\s*[／\/及或]\s*新資金|現有資金\/續存/.test(text)) {
    const i = tags.indexOf('新資金'); if (i >= 0) tags.splice(i, 1);
  }
  // "分行「…手機App」" column headers: available both ways, not an online-only condition
  if (/分行[^。|]{0,6}[「『(（]?[^。|]{0,12}(手機|網上|App)/i.test(text) && !/只限|只適用於[^。]{0,6}(網上|手機)/.test(text)) {
    const i = tags.indexOf('網上/手機開立'); if (i >= 0) tags.splice(i, 1);
  }
  if (/只適用於分行|只限分行|只限親臨分行/.test(text) && !tags.includes('只限分行')) tags.push('只限分行');
  // "優惠不適用於透過網上理財…開立" means branch only
  if (/不適用於[^。]{0,30}(網上|流動|手機|電話)/.test(text)) {
    const i = tags.indexOf('網上/手機開立'); if (i >= 0) tags.splice(i, 1);
    if (!tags.includes('只限分行')) tags.push('只限分行');
  }
  // keep Premier Elite from also tagging Premier
  if (tags.includes('卓越理財尊尚')) return tags.filter((t) => t !== '卓越理財');
  return tags;
}

const PROMO_WORDS = /優惠|特惠|特優|推廣|新資金|promotion|offer|preferential|special|campaign/i;
const FX_CONVERT = /(?:兌換|轉換)[^。]{0,40}(?:同時|並|後|再)[^。]{0,25}(?:設立|開立|敘造|敍做|辦理)[^。]{0,30}定期|經本行(?:兌換|轉換)|兌換交易|兌換現有外幣|以外幣兌換/;

function parseDeposits(page, source) {
  const pageText = page.text || '';
  const pageFx = FX_CONVERT.test(pageText);
  const pageMins = contextMins(pageText, { strict: true });
  const pagePct = /年利率|利率|interest rate|p\.a\./i.test(pageText);
  const pageType = source.type || 'board';
  // 1st pass: read every table
  const perTable = [];
  for (const tbl of page.tables) {
    const ctx = tbl.context || '';
    const near = lastSegments(ctx);
    // "可享以下活期儲蓄存款年利率" — a savings offer laid out like a deposit table
    if (SAVINGS.test(near) && !/定期/.test(near)) continue;
    // a title row such as "萬利錢儲蓄存款" over the whole table (not a "儲蓄" column header)
    const title0 = [...new Set((tbl.grid[0] || []).filter(Boolean))];
    if (title0.length <= 2 && /儲蓄/.test(title0.join(' ')) && !tenorsOf(title0.join(' ')).length && !/定期|time deposit/i.test(title0.join(' ') + ' ' + (tbl.grid[1] || []).join(' '))) continue;
    const near0 = near;
    const weak0 = (near0.replace(/\d[\d.,%]*|[^\u4e00-\u9fff]/g, '').length < 8) || (near0.match(/%/g) || []).length >= 3;
    const prevT = perTable[perTable.length - 1];
    const found = analyseDepositTable(tbl, { prevCcy: weak0 && prevT ? prevT.ccy : null, pct: pagePct });
    if (!found.length) continue;
    const head = tbl.grid.slice(0, 2).flat().join(' ');
    const weak = (near.replace(/\d[\d.,%]*|[^\u4e00-\u9fff]/g, '').length < 8) || (near.match(/%/g) || []).length >= 3;
    const prev = perTable[perTable.length - 1];
    let type = pageType;
    const shortMax = Math.max(0, ...found.filter((f) => f.tenorDays <= 14).map((f) => f.rate));
    if (pageType === 'auto') type = PROMO_WORDS.test(near + ' ' + head) || shortMax >= 3 ? 'promo' : (weak && prev ? prev.type : 'board');
    // conditions such as 新資金 / 網上 from the table's own title; customer tier only when the title is short (a tab label)
    const headTags = conditionsFrom(head, { noTier: true }).filter((x) => x === '需經本行兌換' || x === '新資金');
    const tierList = /其他(?:個人)?客戶|一般客戶|其他客戶|One\b/.test(near) && (near.match(/理財|客戶/g) || []).length > 2;
    const namesTier = /(貴賓理財|貴賓|私人財富|中銀理財|工銀財富|理財金|顯卓|至尊理財|卓越理財|優越理財|Citigold|豐盛)[」"]?\s*客戶/.test(near);
    const tags = [...new Set([...conditionsFrom(near, { noTier: tierList || (near.length > 40 && !namesTier) }), ...conditionsFrom(ctx.slice(-140), { noTier: true }), ...headTags])];
    if (/親臨分行|於分行(?:辦理|開立)|透過本行分行/.test(near) && !/網上|手機|流動/.test(near)) { const i = tags.indexOf('網上/手機開立'); if (i >= 0) tags.splice(i, 1); if (!tags.includes('只限分行')) tags.push('只限分行'); }
    if (weak && prev) for (const x of prev.tags) if (!tags.includes(x) && !PREMIUM_TAGS.includes(x)) tags.push(x);
    if (/new-?customer|newcustomer|new_customer|新客/i.test(source.url || '')) tags.push('新客戶');
    const regularTier = /其他(?:個人)?客戶|一般(?:個人)?客戶|滙豐One|綜合(?:戶口|客戶)|e時代|智選理財|BEA GOAL|優進理財|自在理財|智盈理財|其他個人/.test(near.slice(-60));
    const tiered = regularTier || tags.some((t) => PREMIUM_TAGS.includes(t));
    const shortOnly = Math.max(...found.map((f) => f.tenorDays)) <= 31;
    const mins = contextMins(near + ' ' + head + ' ' + (tbl.grid.slice(-2).flat().join(' ')) + ' ' + ctx.slice(-300), { loose: true });
    perTable.push({ tbl, found, type, tags, tiered, shortOnly, mins, sig: JSON.stringify(tbl.grid), ccy: found[0].currency });
  }
  // the same table often appears several times (mobile copy, hidden tab). Drop copies without a
  // customer-tier label when a labelled copy exists, so a premium-only rate is not shown to everyone.
  const labelled = new Set(perTable.filter((t) => t.tiered).map((t) => t.sig));
  const rows = [];
  for (const t of perTable) {
    if (!t.tiered && labelled.has(t.sig)) continue;
    for (const f of t.found) {
      const segTags = conditionsFrom((f.segment || '') + ' ' + (f.tierLabel || ''));
      const conditions = new Set([...(source.conditions || []), ...t.tags, ...segTags]);
      // short "convert-and-deposit" offers: the condition is often only stated once on the page
      if (t.type === 'promo' && pageFx && t.shortOnly && !conditions.has('新資金')) conditions.add('需經本行兌換');
      if (f.upTo) conditions.add('最高息（視乎條件）');
      if (t.type === 'promo' && f.rate < (f.currency === 'JPY' ? 0.02 : 0.2)) continue; // placeholder rates such as 0.001%
      let minAmount = f.minAmount;
      const pairs = amountPairs(f.tierLabel);
      if (Object.keys(pairs).length >= 2 && pairs[f.currency] != null) minAmount = pairs[f.currency];
      let minFrom = minAmount != null ? 'table' : null;
      if (minAmount == null) {
        const v = t.mins[f.currency] ?? (f.currency !== 'HKD' ? t.mins.FOREIGN : undefined);
        if (v != null) { minAmount = v; minFrom = 'text'; }
      }
      if (minAmount == null) {
        const v = pageMins[f.currency] ?? (f.currency !== 'HKD' ? pageMins.FOREIGN : undefined);
        if (v != null) { minAmount = v; minFrom = 'page'; }
      }
      rows.push({ ...f, minAmount, minFrom, type: t.type, conditions: Array.from(conditions), sourceUrl: source.url });
    }
  }
  // keep only currencies we track and dedupe exact duplicates
  const seen = new Set();
  return rows.filter((r) => {
    if (!CURRENCIES[r.currency]) return false;
    if (source.currencies && !source.currencies.includes(r.currency)) return false;
    const k = [r.currency, r.tenorDays, r.rate, r.minAmount, r.segment, r.type, r.conditions.join(',')].join('|');
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
  // PDFs space out digits ("2026 年 10 月 1 7 日 至 20 日")
  const t = (text || '').replace(/(\d)\s+(?=\d\s*[年月日])/g, '$1');
  // "2026年10月17日至20日": end date in the same month
  const same = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*\d{1,2}\s*日\s*(?:至|-|–)\s*(\d{1,2})\s*日/);
  const re = /(?:至|直至|截至|止|until|till|to)\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/gi;
  let m, best = same ? `${same[1]}-${same[2].padStart(2, '0')}-${same[3].padStart(2, '0')}` : null;
  while ((m = re.exec(t))) {
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!best || d > best) best = d;
  }
  return best;
}

// Upper limit on how much can earn a promo rate: "累計存款金額最高為HK$200,000", "存款上限為港幣50萬"
function capAmounts(text) {
  const out = {};
  const t = (text || '').replace(/\s+/g, ' ');
  const re = /(?:(?:累計)?存款(?:金額|額)?(?:最高|上限)(?:為|是|:|：)?|最高(?:存款|可存)(?:金額|額)?(?:為|:|：)?)\s*(HK\$|US\$|港幣|港元|美元|人民幣|澳元|英鎊|日圓)?\s*([\d,]+(?:\.\d+)?)\s*(萬)?\s*(港元|港幣|美元|人民幣|澳元|英鎊|日圓)?/g;
  const code = (w) => ({ 'HK$': 'HKD', 港幣: 'HKD', 港元: 'HKD', 'US$': 'USD', 美元: 'USD', 人民幣: 'CNY', 澳元: 'AUD', 英鎊: 'GBP', 日圓: 'JPY' }[w]);
  let m;
  while ((m = re.exec(t))) {
    const c = code(m[1] || m[4]);
    let v = parseFloat(m[2].replace(/,/g, '')); if (m[3]) v *= 1e4;
    if (!c || !(v >= 1000)) continue;
    if (out[c] == null || v > out[c]) out[c] = v;
  }
  return out;
}
// End date of the promotion period written closest after a given spot on the page
// ("推廣期：2026年10月2日至2026年12月31日"), so a later credit-card offer's date isn't used.
function validUntilNear(text, at) {
  if (!(at >= 0)) return null;
  const win = (text || '').slice(at, at + 500);
  const m = win.match(/(?:推廣期|優惠期|活動期)[^。]{0,40}?(?:至|直至|-|–)\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

// ---- text fallback (pages that lay rates out with <div>s instead of <table>) ----
// Looks for a tenor and a % rate on the same line, or a tenor line followed closely
// by a rate line. Currency comes from the line itself or the nearest heading above.
const RATE_IN_TEXT = /(\d{1,2}(?:\.\d{1,4})?)\s*%/g;
const TENOR_IN_TEXT = /(\d{1,2}|[一二兩三六九十]{1,3})\s*(?:個)?\s*(日|天|星期|週|個月|月|年|days?|weeks?|months?|M\b)/gi;
// PDF text often spaces out numbers ("3. 5 5 厘", "2.90 %") and uses 厘 for %
function normaliseRateText(l) {
  return l
    .replace(/(?<![\d.])(\d{1,2})\s*\.\s*((?:\d\s*){1,4})(%|厘)/g, (m, a, b) => `${a}.${b.replace(/\s+/g, '')}%`)
    .replace(/(\d)\s+%/g, '$1%')
    .replace(/(\d)\s*厘/g, '$1%');
}
function parseTextRates(text, source) {
  const lines = (text || '').split(/\n+/).map((l) => normaliseRateText(l.replace(/\s+/g, ' ').trim())).filter(Boolean);
  const out = [];
  // rate sheets laid out as a row of tenors with a row of rates under it (common in PDFs):
  //   存款金額 港幣 20 萬元至 100 萬元以下 港幣 100 萬元至 1000 萬元
  //   存 款 期 1 個月 3 個月 … 12 個月 1 個月 … 12 個月
  //   年 利 率 2.10% 2.85% … 3.20%
  let blockStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const rates = [...lines[i].matchAll(RATE_IN_TEXT)].map((m) => parseFloat(m[1]));
    const tenorLine = (k) => (k >= 0 ? [...lines[k].matchAll(TENOR_IN_TEXT)].map((m) => parseTenor(m[0])).filter(Boolean) : []);
    if (rates.length < 2 || tenorLine(i).length) continue;
    let k = i - 1, tenors = tenorLine(k);
    if (!tenors.length || [...lines[k].matchAll(RATE_IN_TEXT)].length) { blockStart = i + 1; continue; }
    // a short tenor line just above can belong at the end (drawn slightly higher in the PDF)
    if (tenors.length < rates.length && k - 1 >= 0) { const extra = tenorLine(k - 1); if (extra.length && !/%/.test(lines[k - 1]) && tenors.length + extra.length === rates.length) tenors = tenors.concat(extra); }
    if (tenors.length !== rates.length) { blockStart = i + 1; continue; }
    const block = lines.slice(blockStart, i + 1);
    const amtLine = [...block].reverse().find((l) => /存款金額|存款額|金額/.test(l)) || '';
    const head = block.filter((l) => l.length <= 40);
    const own = onlyCurrency(amtLine.replace(/存款金額|存款額|金額/g, ''));
    const ccy = own && own !== 'OTHER' ? own : (() => { for (let j = head.length - 1; j >= 0; j--) { const c = onlyCurrency(head[j]); if (c && c !== 'OTHER') return c; } for (let j = blockStart - 1; j >= Math.max(0, blockStart - 8); j--) { const c = lines[j].length <= 40 && onlyCurrency(lines[j]); if (c && c !== 'OTHER') return c; } return null; })();
    // groups restart when tenors go back down ("…12 個月 1 個月…"); one minimum per group
    const groupOf = []; let g = 0;
    tenors.forEach((d, n) => { if (n && d < tenors[n - 1]) g++; groupOf.push(g); });
    const nums = [...amtLine.matchAll(/(\d+(?:\.\d+)?)\s*萬/g)].map((m) => parseFloat(m[1]) * 1e4);
    const starts = nums.length === 2 * (g + 1) ? nums.filter((_, n) => n % 2 === 0) : nums.slice(0, g + 1);
    const near = block.join(' ');
    tenors.forEach((d, n) => {
      if (!ccy || !CURRENCIES[ccy] || d < 7 || d > 1100 || !(rates[n] > 0.01 && rates[n] < 15)) return;
      out.push({ currency: ccy, tenorDays: d, tenor: tenorLabel(d), rate: rates[n], minAmount: starts[groupOf[n]] ?? null, minFrom: starts[groupOf[n]] != null ? 'table' : null, tierLabel: (amtLine || head.join(' ')).slice(0, 80), segment: '', fromText: true, near });
    });
    blockStart = i + 1;
  }
  const paired = new Set(out.map((r) => r.currency + r.tenorDays));
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
    if (tenors.length === 1 && rates.length >= 1) {
      if (paired.has((ccy || '') + tenors[0])) continue;
      // several rates on one line are usually customer tiers (private / premier / ordinary): use the lowest,
      // which an ordinary customer can get
      push(ccy, tenors[0], Math.min(...rates), i, line);
      continue;
    }
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
  }).map((r) => {
    const conditions = conditionsFrom(r.near.slice(-300));
    return { ...r, type: source.type || 'promo', conditions, sourceUrl: source.url, near: undefined, upTo: undefined };
  });
}
function effectiveDate(text) {
  const m = (text || '').match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const e = (text || '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})/);
  if (e) return `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}`;
  return null;
}

module.exports = { capAmounts, validUntilNear, amountPairs, contextMins, amountCurrency, lastSegments, tenorsOf, parseTextRates, validUntil, parseDeposits, parseFx, parseTenor, parseRate, parseMinAmount, lastCurrency, effectiveDate, tenorLabel, conditionsFrom };
