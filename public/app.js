// 定存息口通 — front end. Plain JS, no build step.
(() => {
  'use strict';

  // Data is committed to GitHub every 2 hours by the scraper. Reading it straight
  // from GitHub means the site shows new rates without Netlify needing to redeploy.
  const REPO_DATA = 'https://raw.githubusercontent.com/mickoo129/bankrate/main/public/data/';
  const LOCAL_DATA = 'data/';

  const CCY = [
    { code: 'HKD', name: '港元' }, { code: 'USD', name: '美元' }, { code: 'CNY', name: '人民幣' },
    { code: 'AUD', name: '澳元' }, { code: 'GBP', name: '英鎊' }, { code: 'JPY', name: '日圓' },
  ];
  const CCY_NAME = Object.fromEntries(CCY.map((c) => [c.code, c.name]));
  const TENORS = [
    { d: 7, label: '7日' }, { d: 30, label: '1個月' }, { d: 90, label: '3個月' },
    { d: 180, label: '6個月' }, { d: 360, label: '12個月' },
  ];
  const TENOR_LABEL = (d) => (TENORS.find((t) => t.d === d) || {}).label || (d < 30 ? `${d}日` : `${Math.round(d / 30)}個月`);
  const DAYS = (d) => (d === 360 ? 365 : d === 180 ? 182 : d === 90 ? 91 : d); // calendar days for interest

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => parseFloat(String(v).replace(/[^\d.\-]/g, '')) || 0;
  const fmt = (v, dp = 0) => Number(v).toLocaleString('en-HK', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const pct = (v) => (Math.round(v * 1000) / 1000).toString();

  const state = {
    data: null, history: null, liveMid: null,
    ccy: 'HKD', tenor: 90, amount: 100000, plainOnly: false, incFx: false,
    tCcy: 'HKD', tTenor: 90, tBank: '',
  };
  try { Object.assign(state, JSON.parse(localStorage.getItem('dep-prefs') || '{}')); } catch {}
  const save = () => { try { localStorage.setItem('dep-prefs', JSON.stringify({ ccy: state.ccy, tenor: state.tenor, amount: state.amount, plainOnly: state.plainOnly, incFx: state.incFx })); } catch {} };

  // ---------- data loading ----------
  async function getJson(name) {
    for (const base of [REPO_DATA, LOCAL_DATA]) {
      try {
        const r = await fetch(base + name + '?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch {}
    }
    return null;
  }
  async function loadLiveMid() {
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/HKD');
      const j = await r.json();
      if (j && j.rates) {
        state.liveMid = { rates: Object.fromEntries(CCY.slice(1).map((c) => [c.code, 1 / j.rates[c.code]])), asOf: j.time_last_update_utc };
      }
    } catch {}
  }
  const mid = () => (state.liveMid || (state.data && state.data.mid) || { rates: {} });

  function timeAgo(iso) {
    if (!iso) return '未知';
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d) / 60000);
    const local = d.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    if (mins < 60) return `${local}（${Math.max(mins, 1)} 分鐘前）`;
    if (mins < 60 * 48) return `${local}（${Math.round(mins / 60)} 小時前）`;
    return `${local}（${Math.round(mins / 1440)} 日前）`;
  }
  const todayHK = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}月${+d}日`; };

  // ---------- chips ----------
  function chips(el, items, current, onPick) {
    el.innerHTML = items.map((it) => `<button class="chip" role="radio" aria-checked="${it.v === current}" data-v="${it.v}">${esc(it.label)}</button>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      const v = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
      el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
      onPick(v);
    };
  }

  // ---------- tab: 定期息口 ----------
  function qualifies(r) {
    if (r.currency !== state.ccy || r.tenorDays !== state.tenor) return false;
    if (r.minAmount && r.minAmount > state.amount) return false;
    if (state.plainOnly && ((r.conditions && r.conditions.length) || r.segment)) return false;
    if (!state.incFx && (r.conditions || []).includes('需經本行兌換')) return false;
    if (r.validUntil && r.validUntil < todayHK()) return false; // expired offer
    return true;
  }
  function condTags(r) {
    const out = [];
    if (r.type === 'promo') out.push('<span class="chop">優惠</span>');
    for (const c of r.conditions || []) out.push(`<span class="chop">${esc(c)}</span>`);
    if (r.segment) out.push(`<span class="plain">${esc(r.segment)}</span>`);
    if (r.type === 'promo' && !(r.conditions || []).length && !r.segment) out.push('<span class="plain">條件請睇銀行原文</span>');
    if (!out.length) out.push('<span class="plain">牌價・冇特別條件</span>');
    return out.join(' ');
  }
  function endsTag(r) {
    if (!r.validUntil) return '';
    const days = Math.ceil((new Date(r.validUntil + 'T23:59:59+08:00') - Date.now()) / 864e5);
    if (days < 0) return '<span class="ends">優惠可能已完結</span>';
    return `<span class="ends">優惠至 ${shortDate(r.validUntil)}${days <= 14 ? `（剩 ${days} 日）` : ''}</span>`;
  }

  function renderRates() {
    const d = state.data;
    const list = $('#ledger');
    $('#amt-ccy').textContent = state.ccy;
    if (!d) { list.innerHTML = '<li class="empty">讀取緊數據…</li>'; return; }
    const lines = [];
    let noData = 0;
    for (const b of d.banks) {
      const rows = (b.deposits || []).filter(qualifies).sort((x, y) => y.rate - x.rate);
      if (!rows.length) { noData++; continue; }
      lines.push({ b, best: rows[0], rows });
    }
    lines.sort((x, y) => y.best.rate - x.best.rate);
    const days = DAYS(state.tenor);
    $('#rates-hint').textContent = lines.length
      ? `${CCY_NAME[state.ccy]} ${TENOR_LABEL(state.tenor)}・存 ${state.ccy} ${fmt(state.amount)}，${lines.length} 間銀行有合資格息口。數字係年利率，「到期利息」按存期日數計，未扣任何費用。`
      : '';
    if (!lines.length) {
      list.innerHTML = `<li class="empty">暫時冇銀行有符合條件嘅 ${CCY_NAME[state.ccy]} ${TENOR_LABEL(state.tenor)} 息口。試吓換存期、提高金額，或者取消「只睇冇特別條件」。</li>`;
      return;
    }
    list.innerHTML = lines.map(({ b, best, rows }, i) => {
      const interest = state.amount * best.rate / 100 * days / 365;
      const others = (b.deposits || []).filter((r) => r.currency === state.ccy && !(r.validUntil && r.validUntil < todayHK())).sort((x, y) => x.tenorDays - y.tenorDays || y.rate - x.rate).slice(0, 40);
      const staleNote = b.status === 'stale' ? `<span class="stale">數據截至 ${timeAgo(b.lastSuccess)}</span>` : '';
      return `<li class="line">
        <span class="pos">${i + 1}</span>
        <div><div class="bank">${esc(b.name)}${b.nameEn && b.nameEn !== b.name ? `<small>${esc(b.nameEn)}</small>` : ''}</div></div>
        <div class="rate">${pct(best.rate)}<span>%</span></div>
        <div class="sub">${condTags(best)} ${best.minAmount ? `<span>起存 ${state.ccy} ${fmt(best.minAmount)}</span>` : ''} ${endsTag(best)} ${staleNote}
          <a class="src" href="${esc(best.url)}" target="_blank" rel="noopener">銀行原文</a></div>
        <div class="earn">到期利息 ≈ ${state.ccy} ${fmt(interest, state.ccy === 'JPY' ? 0 : 2)}</div>
        <details class="more"><summary>${esc(b.name)}全部 ${CCY_NAME[state.ccy]} 定期息口（${others.length}）</summary>
          <table><tbody>${others.map((r) => `<tr><td>${esc(r.tenor || TENOR_LABEL(r.tenorDays))}</td><td>${condTags(r)} ${r.minAmount ? `起存 ${fmt(r.minAmount)}` : ''} ${endsTag(r)}</td><td class="r">${pct(r.rate)}%</td></tr>`).join('')}</tbody></table>
        </details>
      </li>`;
    }).join('') + (noData ? `<li class="empty">另有 ${noData} 間銀行暫時未讀到呢個貨幣／存期嘅息口（可能冇提供，或者網頁讀唔到）。</li>` : '');
    list.classList.remove('fresh'); void list.offsetWidth; list.classList.add('fresh');
  }

  // ---------- tab: 匯價 ----------
  function renderFx() {
    const from = $('#fxFrom').value, to = $('#fxTo').value, amt = num($('#fxAmt').value);
    const m = mid().rates;
    const rateOf = (c) => (c === 'HKD' ? 1 : m[c]);
    const midOut = from === to ? amt : amt * rateOf(from) / rateOf(to);
    const dp = to === 'JPY' ? 0 : 2;
    $('#fxMid').innerHTML = rateOf(from) && rateOf(to)
      ? `市場參考價：${esc(from)} ${fmt(amt, from === 'JPY' ? 0 : 2)} ≈ <b>${esc(to)} ${fmt(midOut, dp)}</b>（1 ${esc(from)} = ${fmt(rateOf(from) / rateOf(to), 4)} ${esc(to)}）`
      : '市場參考價暫時讀唔到。';
    const out = [];
    for (const b of (state.data ? state.data.banks : [])) {
      const fx = b.fx || {};
      let hkd, got;
      if (from === 'HKD') hkd = amt; else if (fx[from]) hkd = amt * fx[from].buy; else continue;
      if (to === 'HKD') got = hkd; else if (fx[to]) got = hkd / fx[to].sell; else continue;
      if (from === to) continue;
      out.push({ b, got });
    }
    out.sort((x, y) => y.got - x.got);
    $('#fxLedger').innerHTML = out.length ? out.map(({ b, got }, i) => {
      const cost = midOut ? (1 - got / midOut) * 100 : null;
      return `<li class="line"><span class="pos">${i + 1}</span>
        <div><div class="bank">${esc(b.name)}${b.nameEn && b.nameEn !== b.name ? `<small>${esc(b.nameEn)}</small>` : ''}</div></div>
        <div class="rate">${fmt(got, dp)}<span> ${esc(to)}</span></div>
        <div class="sub">${cost != null ? `<span>比市場價少 ${cost.toFixed(2)}%</span>` : ''} <span>牌價時間：${timeAgo(b.fxAt)}</span></div></li>`;
    }).join('') : '<li class="empty">暫時未讀到銀行嘅電匯牌價，可以先參考上面嘅市場價。</li>';
  }

  // ---------- tab: 外幣定期回報 ----------
  function bestRate(ccy, tenor) {
    let best = null;
    for (const b of (state.data ? state.data.banks : [])) for (const r of b.deposits || []) {
      if (r.currency === ccy && r.tenorDays === tenor && !(r.conditions || []).includes('需經本行兌換') && !(r.validUntil && r.validUntil < todayHK()) && (!best || r.rate > best.r.rate)) best = { b, r };
    }
    return best;
  }
  function avgSpread(ccy) {
    const m = mid().rates[ccy]; if (!m) return 0.4;
    const s = [];
    for (const b of (state.data ? state.data.banks : [])) { const f = (b.fx || {})[ccy]; if (f) s.push((f.sell - m) / m * 100); }
    if (!s.length) return 0.4;
    s.sort((a, b) => a - b);
    return Math.max(0.05, +s[Math.floor(s.length / 2)].toFixed(2));
  }
  let tdAuto = true;
  function fillTdDefaults() {
    const ccy = $('#tdCcy').value, tenor = +$('#tdTenor').value;
    const best = bestRate(ccy, tenor);
    $('#tdRate').value = best ? best.r.rate : '';
    $('#tdRate').dataset.src = best ? `${best.b.name}${best.r.type === 'promo' ? '（優惠，可能有條件）' : ''}` : '';
    $('#tdSpread').value = avgSpread(ccy);
  }
  function renderTd() {
    const ccy = $('#tdCcy').value, tenor = +$('#tdTenor').value, amt = num($('#tdAmt').value);
    const rate = num($('#tdRate').value), s = num($('#tdSpread').value) / 100, move = num($('#tdMove').value) / 100;
    const m = mid().rates[ccy];
    const out = $('#tdResult');
    if (!m || !amt) { out.innerHTML = '<p>未有匯價數據，暫時計唔到。</p>'; return; }
    const days = DAYS(tenor);
    const units = amt / (m * (1 + s));
    const interest = units * rate / 100 * days / 365;
    const back = (units + interest) * m * (1 + move) * (1 - s);
    const gain = back - amt;
    const annual = gain / amt * 365 / days * 100;
    const fxCost = amt - units * m * (1 - s);
    const hk = bestRate('HKD', tenor);
    const hkGain = hk ? amt * hk.r.rate / 100 * days / 365 : null;
    const breakeven = ((amt / ((units + interest) * m * (1 - s))) - 1) * 100;
    const src = $('#tdRate').dataset.src;
    out.innerHTML = `
      <div class="row"><span>換成 ${esc(CCY_NAME[ccy])}（已計差價）</span><b>${esc(ccy)} ${fmt(units, ccy === 'JPY' ? 0 : 2)}</b></div>
      <div class="row"><span>${TENOR_LABEL(tenor)}利息（年息 ${pct(rate)}%${src ? '，' + esc(src) : ''}）</span><b>${esc(ccy)} ${fmt(interest, ccy === 'JPY' ? 0 : 2)}</b></div>
      <div class="row"><span>來回換匯成本（假設匯率不變）</span><b class="neg">−HKD ${fmt(fxCost, 0)}</b></div>
      <div class="row total"><span>到期換返港元，淨賺</span><b class="${gain >= 0 ? 'pos-c' : 'neg'}">${gain >= 0 ? '+' : '−'}HKD ${fmt(Math.abs(gain), 0)}</b></div>
      <div class="row"><span>折合實際年回報</span><b class="${annual >= 0 ? 'pos-c' : 'neg'}">${annual.toFixed(2)}%</b></div>
      ${hk ? `<div class="row"><span>對比：直接做港元 ${TENOR_LABEL(tenor)}（${esc(hk.b.name)} ${pct(hk.r.rate)}%）</span><b>+HKD ${fmt(hkGain, 0)}</b></div>` : ''}
      <p>${esc(CCY_NAME[ccy])}到期時只要跌多過 <b>${Math.abs(breakeven).toFixed(2)}%</b>，就會蝕本金。${ccy === 'USD' ? '美元同港元掛鈎，匯率波動通常好細，主要成本係換匯差價。' : '呢個貨幣同港元冇掛鈎，匯率升跌可以遠大於利息。'}存期愈短，換匯成本佔回報嘅比例愈大。</p>`;
  }

  // ---------- tab: 走勢 ----------
  const PALETTE = ['var(--ink)', 'var(--chop)'];
  function renderTrend() {
    const h = state.history;
    const el = $('#chart');
    const key = `${state.tCcy}|${state.tTenor}`;
    const series = [];
    if (h && h.series) {
      if (h.series['ALL|' + key]) series.push({ name: '全市場最高', pts: h.series['ALL|' + key] });
      if (state.tBank && h.series[state.tBank + '|' + key]) {
        const b = state.data.banks.find((x) => x.id === state.tBank);
        series.push({ name: b ? b.name : state.tBank, pts: h.series[state.tBank + '|' + key] });
      }
    }
    const n = series.reduce((a, s) => Math.max(a, s.pts.length), 0);
    if (!series.length || n < 2) {
      el.innerHTML = `<p class="empty">${series.length ? '系統啱啱開始記錄，要累積幾日數據先畫到走勢。目前' + esc(series[0].name) + '：' + pct(series[0].pts[0][1]) + '%' : '暫時未有呢個貨幣／存期嘅紀錄。'}</p>`;
      $('#trendNote').textContent = '';
      return;
    }
    const all = series.flatMap((s) => s.pts);
    const dates = [...new Set(all.map((p) => p[0]))].sort();
    const t0 = Date.parse(dates[0]), t1 = Date.parse(dates[dates.length - 1]) || t0 + 1;
    let lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1]));
    if (hi - lo < 0.2) { hi += 0.1; lo = Math.max(0, lo - 0.1); }
    const W = 720, H = 300, L = 44, R = 12, T = 14, B = 30;
    const x = (d) => L + (Date.parse(d) - t0) / Math.max(t1 - t0, 1) * (W - L - R);
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (hi - lo) * i / ticks;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--ink-2)">${v.toFixed(2)}%</text>`;
    }
    const lab = [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]];
    grid += [...new Set(lab)].map((d) => `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${shortDate(d)}</text>`).join('');
    const paths = series.map((s, i) => {
      // step line: a rate holds until it changes
      let dpath = '';
      s.pts.forEach((p, j) => {
        const X = x(p[0]), Y = y(p[1]);
        dpath += j === 0 ? `M${X},${Y}` : `H${X}V${Y}`;
      });
      return `<path d="${dpath}" fill="none" stroke="${PALETTE[i]}" stroke-width="${i ? 2 : 2.5}" ${i ? 'stroke-dasharray="5 4"' : ''}/>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(CCY_NAME[state.tCcy])} ${TENOR_LABEL(state.tTenor)} 定期息口走勢">${grid}${paths}</svg>
      <div class="legend">${series.map((s, i) => `<span><i style="background:${PALETTE[i]}"></i>${esc(s.name)}</span>`).join('')}</div>`;
    const s0 = series[0].pts;
    const peak = s0.reduce((a, p) => (p[1] > a[1] ? p : a), s0[0]);
    const now = s0[s0.length - 1];
    $('#trendNote').textContent = `由 ${shortDate(s0[0][0])} 開始記錄：最高 ${pct(peak[1])}%（${shortDate(peak[0])}），而家 ${pct(now[1])}%。優惠息口通常有限期，到期後會跌返牌價水平。`;
  }

  // ---------- tab: 資料來源 ----------
  function renderStatus() {
    const tb = $('#statusTable tbody');
    if (!state.data) return;
    const label = { ok: '正常', stale: '暫時讀唔到，顯示舊數據', none: '暫時未能自動讀取' };
    tb.innerHTML = state.data.banks.slice().sort((a, b) => (a.status === b.status ? 0 : a.status === 'ok' ? -1 : b.status === 'ok' ? 1 : a.status === 'stale' ? -1 : 1)).map((b) => `<tr>
      <td>${esc(b.name)}</td>
      <td><span class="dot ${b.status}"></span>${label[b.status] || b.status}</td>
      <td>${b.lastSuccess ? timeAgo(b.lastSuccess) : '—'}</td>
      <td>${(b.sources || []).slice(0, 3).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(' ') || `<a href="${esc(b.site)}" target="_blank" rel="noopener">官網</a>`}</td>
    </tr>`).join('');
  }

  // ---------- wiring ----------
  function setupTabs() {
    const tabs = document.querySelectorAll('.tabs button');
    const show = (name) => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
      if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
      window.scrollTo({ top: 0 });
    };
    tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
    const h = location.hash.slice(1);
    if (h && document.getElementById('tab-' + h)) show(h);
  }
  function amountInput(el, onVal) {
    el.addEventListener('input', () => {
      const v = num(el.value);
      onVal(v);
    });
    el.addEventListener('blur', () => { const v = num(el.value); el.value = v ? fmt(v) : ''; });
  }
  function fillSelect(el, items, val) {
    el.innerHTML = items.map((i) => `<option value="${i.v}">${esc(i.label)}</option>`).join('');
    if (val != null) el.value = val;
  }

  function init() {
    setupTabs();
    const ccyItems = CCY.map((c) => ({ v: c.code, label: c.name }));
    const tenorItems = TENORS.map((t) => ({ v: t.d, label: t.label }));
    chips($('#ccy'), ccyItems, state.ccy, (v) => { state.ccy = v; save(); renderRates(); });
    chips($('#tenor'), tenorItems, state.tenor, (v) => { state.tenor = v; save(); renderRates(); });
    $('#amount').value = fmt(state.amount);
    amountInput($('#amount'), (v) => { state.amount = v; save(); renderRates(); });
    $('#plainOnly').checked = state.plainOnly;
    $('#incFx').checked = state.incFx;
    $('#plainOnly').onchange = (e) => { state.plainOnly = e.target.checked; save(); renderRates(); };
    $('#incFx').onchange = (e) => { state.incFx = e.target.checked; save(); renderRates(); };

    fillSelect($('#fxFrom'), CCY.map((c) => ({ v: c.code, label: `${c.code} ${c.name}` })), 'HKD');
    fillSelect($('#fxTo'), CCY.map((c) => ({ v: c.code, label: `${c.code} ${c.name}` })), 'USD');
    $('#fxFrom').onchange = $('#fxTo').onchange = renderFx;
    $('#fxAmt').addEventListener('input', renderFx);
    $('#fxAmt').addEventListener('blur', () => { $('#fxAmt').value = fmt(num($('#fxAmt').value)); });
    $('#fxSwap').onclick = () => { const a = $('#fxFrom').value; $('#fxFrom').value = $('#fxTo').value; $('#fxTo').value = a; renderFx(); };

    fillSelect($('#tdCcy'), CCY.slice(1).map((c) => ({ v: c.code, label: c.name })), 'USD');
    fillSelect($('#tdTenor'), TENORS.slice(1).map((t) => ({ v: t.d, label: t.label })), 90);
    $('#tdCcy').onchange = $('#tdTenor').onchange = () => { fillTdDefaults(); renderTd(); };
    ['#tdAmt', '#tdRate', '#tdSpread', '#tdMove'].forEach((s) => $(s).addEventListener('input', () => { if (s === '#tdRate') $('#tdRate').dataset.src = '自訂'; renderTd(); }));
    $('#tdAmt').addEventListener('blur', () => { $('#tdAmt').value = fmt(num($('#tdAmt').value)); });

    chips($('#tCcy'), ccyItems, state.tCcy, (v) => { state.tCcy = v; renderTrend(); });
    chips($('#tTenor'), tenorItems, state.tTenor, (v) => { state.tTenor = v; renderTrend(); });
    $('#tBank').onchange = (e) => { state.tBank = e.target.value; renderTrend(); };

    renderRates();
    load();
  }

  async function load() {
    const [data, hist] = await Promise.all([getJson('latest.json'), getJson('history.json'), loadLiveMid()]);
    state.data = data; state.history = hist;
    if (!data) {
      $('#updated').textContent = '暫時讀唔到數據';
      $('#ledger').innerHTML = '<li class="empty">數據檔未準備好。系統第一次更新完成之後就會顯示。</li>';
      return;
    }
    const ok = data.banks.filter((b) => b.status !== 'none').length;
    $('#updated').textContent = `更新：${timeAgo(data.updatedAt)}・${ok} 間銀行`;
    fillSelect($('#tBank'), [{ v: '', label: '（唔比較）' }, ...data.banks.filter((b) => b.deposits && b.deposits.length).map((b) => ({ v: b.id, label: b.name }))], state.tBank);
    renderRates(); renderFx(); fillTdDefaults(); renderTd(); renderTrend(); renderStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
