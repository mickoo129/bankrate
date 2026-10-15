// 定存息口通 — front end. Plain JS, no build step.
(() => {
  'use strict';

  // The scraper commits fresh data to GitHub every 2 hours. Reading it straight from
  // GitHub means new rates appear without Netlify redeploying; the local copy is a fallback.
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
  const DAYS = (d) => (d === 360 ? 365 : d === 180 ? 182 : d === 90 ? 91 : d);
  const PREMIUM = /卓越|尊尚|優越|豐盛|Citigold|優先理財|財富|VIP|私人|Premier|Prestige|Priority|Treasures|Wealth|Elite/i;
  const GROUP_NAME = { major: '大型銀行', mid: '本地及中資銀行', virtual: '虛擬銀行' };
  const REL = [{ v: 'new', label: '新客戶', short: '新客' }, { v: 'existing', label: '現有客戶', short: '現有' }, { v: 'premium', label: '高級理財', short: '高級' }];
  const REL_CODE = { n: 'new', e: 'existing', p: 'premium' };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => parseFloat(String(v).replace(/[^\d.\-]/g, '')) || 0;
  const fmt = (v, dp = 0) => Number(v).toLocaleString('en-HK', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const pct = (v) => (Math.round(v * 1000) / 1000).toString();
  const todayHK = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}月${+d}日`; };

  const state = {
    data: null, history: null, liveMid: null,
    ccy: 'HKD', amount: 100000, sort: 90, view: 'rate',
    pFund: true, pFx: false,
    banks: null, // null = all banks, otherwise array of ids to compare
    rel: {}, // per-bank relationship: 'new' (default) | 'existing' | 'premium'
    open: null, // "bankId|days" of the expanded cell
    tCcy: 'HKD', tTenor: 90, tBank: '',
  };

  // URL parameters win (shared links), then remembered choices
  try { Object.assign(state, JSON.parse(localStorage.getItem('dep-prefs2') || '{}')); } catch {}
  (function readUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('c') && CCY_NAME[q.get('c')]) state.ccy = q.get('c');
    if (q.get('a')) state.amount = num(q.get('a')) || state.amount;
    if (q.get('t') && TENORS.some((t) => t.d === +q.get('t'))) state.sort = +q.get('t');
    if (q.get('v')) state.view = q.get('v') === 'interest' ? 'interest' : 'rate';
    for (const [k, p] of [['pFund', 'f'], ['pFx', 'x']]) if (q.has(p)) state[k] = q.get(p) === '1';
    if (q.has('b')) state.banks = q.get('b') ? q.get('b').split(',') : null;
    if (q.has('r')) {
      state.rel = {};
      for (const pair of q.get('r').split(',')) { const [id, v] = pair.split(':'); if (id && REL_CODE[v]) state.rel[id] = REL_CODE[v]; }
    }
  })();
  const save = () => {
    try { localStorage.setItem('dep-prefs2', JSON.stringify({ ccy: state.ccy, amount: state.amount, sort: state.sort, view: state.view, pFund: state.pFund, pFx: state.pFx, banks: state.banks, rel: state.rel })); } catch {}
  };
  function shareUrl() {
    const q = new URLSearchParams({ c: state.ccy, a: String(state.amount), t: String(state.sort), v: state.view, f: state.pFund ? '1' : '0', x: state.pFx ? '1' : '0' });
    if (state.banks) q.set('b', state.banks.join(','));
    const rel = Object.entries(state.rel).filter(([, v]) => v !== 'new').map(([id, v]) => `${id}:${v[0]}`);
    if (rel.length) q.set('r', rel.join(','));
    return `${location.origin}${location.pathname}?${q}#rates`;
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- data ----------
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
      const j = await (await fetch('https://open.er-api.com/v6/latest/HKD')).json();
      if (j && j.rates) state.liveMid = { rates: Object.fromEntries(CCY.slice(1).map((c) => [c.code, 1 / j.rates[c.code]])), asOf: j.time_last_update_utc };
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

  // ---------- segmented controls ----------
  function seg(el, items, current, onPick) {
    el.innerHTML = items.map((it) => `<button type="button" role="radio" aria-checked="${it.v === current}" data-v="${it.v}">${esc(it.label)}</button>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const v = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
      el.querySelectorAll('button').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
      onPick(v);
    };
  }

  // ---------- offer rules ----------
  const isExpired = (r) => r.validUntil && r.validUntil < todayHK();
  const isPremium = (r) => PREMIUM.test([...(r.conditions || []), r.segment || '', r.tier || ''].join(' '));
  const relOf = (id) => state.rel[id] || 'new';
  function whyNot(r, bankId) {
    const c = r.conditions || [];
    const rel = relOf(bankId);
    if (isExpired(r)) return '優惠已過期';
    if (r.minAmount && r.minAmount > state.amount) return `起存金額 ${fmt(r.minAmount)}，高過你輸入嘅金額`;
    if (rel !== 'new' && c.includes('新客戶')) return '只限新客戶（你揀咗喺呢間係現有客戶）';
    if (!state.pFund && c.includes('新資金')) return '只限新資金';
    if (rel !== 'premium' && isPremium(r)) return '只限高級理財客戶';
    if (!state.pFx && c.includes('需經本行兌換')) return '要先經銀行兌換外幣';
    return '';
  }
  function tagsOf(r, short) {
    const out = [];
    if (r.type === 'promo') out.push('<i class="tag promo">優惠</i>');
    if (!short) {
      for (const c of r.conditions || []) out.push(`<i class="tag cond">${esc(c)}</i>`);
      if (r.segment) out.push(`<i class="tag cond">${esc(r.segment)}</i>`);
      if (r.type === 'promo' && !(r.conditions || []).length && !r.segment) out.push('<i class="tag cond">條件請睇銀行原文</i>');
      if (r.type !== 'promo' && !(r.conditions || []).length && !r.segment) out.push('<i class="tag cond">牌價</i>');
      if (r.validUntil) {
        const days = Math.ceil((new Date(r.validUntil + 'T23:59:59+08:00') - Date.now()) / 864e5);
        out.push(`<i class="tag ends">優惠至 ${shortDate(r.validUntil)}${days >= 0 && days <= 14 ? `（剩 ${days} 日）` : ''}</i>`);
      }
    }
    return out.join(' ');
  }
  function change(bankId, days, current) {
    const s = state.history && state.history.series && state.history.series[`${bankId}|${state.ccy}|${days}`];
    if (!s || s.length < 2) return '';
    const cutoff = new Date(Date.now() - 7 * 864e5 + 8 * 3600e3).toISOString().slice(0, 10);
    let past = null;
    for (const p of s) if (p[0] <= cutoff) past = p[1];
    if (past == null) past = s[0][1];
    const diff = Math.round((current - past) * 100) / 100;
    if (Math.abs(diff) < 0.01) return '';
    return diff > 0 ? `<i class="up" title="7 日前 ${pct(past)}%">▲${pct(diff)}</i>` : `<i class="down" title="7 日前 ${pct(past)}%">▼${pct(-diff)}</i>`;
  }

  // ---------- 定期比較 table ----------
  function renderRates() {
    $('#amt-ccy').textContent = state.ccy;
    const thead = $('#cmp thead'), tbody = $('#cmp tbody');
    const d = state.data;
    thead.innerHTML = `<tr><th scope="col">銀行</th>${TENORS.map((t) => `<th scope="col" class="sortable" data-d="${t.d}" ${t.d === state.sort ? 'aria-sort="descending"' : ''} title="按${t.label}排序">${t.label}${t.d === state.sort ? '<span class="arrow">▼</span>' : ''}</th>`).join('')}</tr>`;
    if (!d) { tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">讀取緊數據…</td></tr>'; return; }

    const rows = [];
    const noData = [];
    for (const b of d.banks) {
      if (state.banks && !state.banks.includes(b.id)) continue;
      const mine = (b.deposits || []).filter((r) => r.currency === state.ccy);
      if (!mine.length) { noData.push(b); continue; }
      const cells = {};
      for (const t of TENORS) {
        const ok = mine.filter((r) => r.tenorDays === t.d && !whyNot(r, b.id)).sort((x, y) => y.rate - x.rate);
        cells[t.d] = ok[0] || null;
      }
      rows.push({ b, cells });
    }
    const best = {};
    for (const t of TENORS) best[t.d] = Math.max(0, ...rows.map((r) => (r.cells[t.d] ? r.cells[t.d].rate : 0)));
    const key = (r) => (r.cells[state.sort] ? r.cells[state.sort].rate : -1);
    const maxAny = (r) => Math.max(-1, ...TENORS.map((t) => (r.cells[t.d] ? r.cells[t.d].rate : -1)));
    rows.sort((x, y) => key(y) - key(x) || maxAny(y) - maxAny(x));

    const withData = rows.filter((r) => maxAny(r) >= 0).length;
    const picked = state.banks ? `比較緊你揀嘅 ${state.banks.length} 間銀行・` : '';
    $('#caption').innerHTML = `${esc(CCY_NAME[state.ccy])}定期・存 <b>${state.ccy} ${fmt(state.amount)}</b>・${picked}${withData} 間有符合你條件嘅息口。${state.view === 'interest' ? '格仔顯示到期利息（未扣任何費用）。' : '數字係年利率。'}`;

    const html = [];
    for (const { b, cells } of rows) {
      const stale = b.status === 'stale' ? `<small class="stale">數據截至 ${esc(timeAgo(b.lastSuccess).split('（')[0])}</small>` : '';
      const relSel = `<select class="rel rel-${relOf(b.id)}" data-rel="${b.id}" aria-label="我喺${esc(b.name)}嘅身份">${REL.map((o) => `<option value="${o.v}" ${relOf(b.id) === o.v ? 'selected' : ''}>${o.short}</option>`).join('')}</select>`;
      html.push(`<tr data-bank="${b.id}"><th scope="row" class="bank-cell"><b>${esc(b.name)}</b>${relSel}${stale}</th>${TENORS.map((t) => {
        const r = cells[t.d];
        const openK = `${b.id}|${t.d}`;
        if (!r) return `<td class="cell empty" data-k="${openK}" tabindex="0" aria-label="${esc(b.name)} ${t.label} 未有符合條件嘅息口">—</td>`;
        const isBest = r.rate === best[t.d] && best[t.d] > 0;
        const v = state.view === 'interest'
          ? `${fmt(state.amount * r.rate / 100 * DAYS(t.d) / 365, 0)}<small> ${state.ccy}</small>`
          : `${pct(r.rate)}<small>%</small>`;
        const board = r.type !== 'promo';
        return `<td class="cell${isBest ? ' best' : ''}${board ? ' board' : ''}${state.open === openK ? ' open' : ''}" data-k="${openK}" tabindex="0" role="button" aria-expanded="${state.open === openK}" aria-label="${esc(b.name)} ${t.label} ${pct(r.rate)}%，撳睇條件">
          <div class="v">${v}</div><div class="meta">${board ? '<i class="tag board">牌價</i>' : tagsOf(r, true)}${change(b.id, t.d, r.rate)}</div></td>`;
      }).join('')}</tr>`);
      if (state.open && state.open.startsWith(b.id + '|')) html.push(detailRow(b, +state.open.split('|')[1]));
    }
    if (!rows.length && state.banks) html.push('<tr><td colspan="6" class="empty-msg">你揀嘅銀行未有呢個貨幣嘅定期數據。撳「揀銀行」加多幾間。</td></tr>');
    if (noData.length) html.push(`<tr class="group"><td colspan="6">未有${esc(CCY_NAME[state.ccy])}定期數據：${noData.map((b) => esc(b.name)).join('、')}</td></tr>`);
    tbody.innerHTML = html.join('');
  }

  function detailRow(b, days) {
    const all = (b.deposits || []).filter((r) => r.currency === state.ccy && r.tenorDays === days).sort((x, y) => y.rate - x.rate);
    const ok = all.filter((r) => !whyNot(r, b.id));
    const no = all.filter((r) => whyNot(r, b.id)).slice(0, 12);
    const offer = (r, bad) => {
      const interest = state.amount * r.rate / 100 * DAYS(days) / 365;
      return `<div class="offer${bad ? ' no' : ''}">
        <div class="tags">${tagsOf(r)} ${r.minAmount ? `<span>起存 ${state.ccy} ${fmt(r.minAmount)}</span>` : ''}</div>
        <div class="r">${pct(r.rate)}%<small>利息 ≈ ${state.ccy} ${fmt(interest, state.ccy === 'JPY' ? 0 : 2)}</small></div>
        ${bad ? `<div class="why">唔符合：${esc(whyNot(r, b.id))}</div>` : ''}
      </div>`;
    };
    const src = (all[0] && all[0].url) || (b.sources || [])[0] || b.site;
    return `<tr class="detail"><td colspan="6"><div class="detail-in">
      <button class="btn close" type="button" data-close>收起</button>
      <h3>${esc(b.name)}・${esc(CCY_NAME[state.ccy])} ${TENOR_LABEL(days)}</h3>
      ${ok.length ? ok.map((r) => offer(r, false)).join('') : '<p class="note">冇符合你條件嘅息口。</p>'}
      ${no.length ? `<p class="note">以下息口你暫時唔符合：</p>${no.map((r) => offer(r, true)).join('')}` : ''}
      <p class="note"><a href="${esc(src)}" target="_blank" rel="noopener">睇銀行原文及條款</a>・數據時間：${esc(timeAgo(b.lastSuccess))}</p>
    </div></td></tr>`;
  }

  function setupTable() {
    const table = $('#cmp');
    const toggle = (td) => {
      if (!td || !td.dataset.k) return;
      state.open = state.open === td.dataset.k ? null : td.dataset.k;
      renderRates();
      const again = table.querySelector(`td[data-k="${state.open}"]`);
      if (again) again.focus({ preventScroll: true });
    };
    table.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-rel]');
      if (!sel) return;
      setRel(sel.dataset.rel, sel.value);
    });
    table.addEventListener('click', (e) => {
      if (e.target.closest('select')) return;
      if (e.target.closest('[data-close]')) { state.open = null; renderRates(); return; }
      const th = e.target.closest('th.sortable');
      if (th) { state.sort = +th.dataset.d; save(); renderRates(); return; }
      if (e.target.closest('a')) return;
      toggle(e.target.closest('td.cell'));
    });
    table.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('td.cell')) { e.preventDefault(); toggle(e.target); }
    });
  }

  // ---------- bank picker ----------
  function setRel(id, v) {
    if (v === 'new') delete state.rel[id]; else state.rel[id] = v;
    save(); renderRates(); renderPicker();
    const b = state.data && state.data.banks.find((x) => x.id === id);
    toast(`${b ? b.name : ''}：按${REL.find((o) => o.v === v).label}計算`);
  }
  function pickerLabel() {
    const total = state.data ? state.data.banks.length : 0;
    $('#pickerBtn').textContent = state.banks ? `揀銀行（已揀 ${state.banks.length}／${total} 間）` : `揀銀行（全部 ${total} 間）`;
  }
  function renderPicker() {
    pickerLabel();
    if (!state.data) return;
    const groups = {};
    for (const b of state.data.banks) (groups[b.group] = groups[b.group] || []).push(b);
    $('#pickerList').innerHTML = Object.entries(GROUP_NAME).filter(([g]) => groups[g]).map(([g, name]) => `
      <div class="pg"><h4>${name}</h4>${groups[g].map((b) => {
        const on = !state.banks || state.banks.includes(b.id);
        const has = b.deposits && b.deposits.length;
        return `<div class="pick-row${has ? '' : ' nodata'}">
          <label class="check"><input type="checkbox" data-pick="${b.id}" ${on ? 'checked' : ''}> ${esc(b.name)}${has ? '' : '<small>（暫未有數據）</small>'}</label>
          <select class="rel rel-${relOf(b.id)}" data-rel="${b.id}" aria-label="我喺${esc(b.name)}嘅身份">${REL.map((o) => `<option value="${o.v}" ${relOf(b.id) === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
        </div>`;
      }).join('')}</div>`).join('');
  }
  function setupPicker() {
    const panel = $('#picker'), btn = $('#pickerBtn');
    const open = (v) => { panel.hidden = !v; btn.setAttribute('aria-expanded', String(v)); };
    btn.onclick = () => open(panel.hidden);
    $('#pickerDone').onclick = () => { open(false); btn.focus(); };
    panel.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-pick]');
      if (cb) {
        const all = state.data.banks.map((b) => b.id);
        let sel = state.banks ? [...state.banks] : [...all];
        sel = cb.checked ? [...new Set([...sel, cb.dataset.pick])] : sel.filter((x) => x !== cb.dataset.pick);
        state.banks = sel.length === all.length ? null : sel;
        save(); renderRates(); pickerLabel();
        return;
      }
      const s = e.target.closest('select[data-rel]');
      if (s) setRel(s.dataset.rel, s.value);
    });
    panel.addEventListener('click', (e) => {
      const p = e.target.closest('[data-preset]'); if (!p) return;
      const banks = state.data.banks;
      const v = p.dataset.preset;
      state.banks = v === 'all' ? null : v === 'none' ? [] : banks.filter((b) => b.group === v).map((b) => b.id);
      save(); renderRates(); renderPicker();
    });
  }

  // ---------- 匯價比較 ----------
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
      if (!Object.keys(fx).length) continue;
      let got = null;
      if (from !== to) {
        let hkd = null;
        if (from === 'HKD') hkd = amt; else if (fx[from]) hkd = amt * fx[from].buy;
        if (hkd != null) { if (to === 'HKD') got = hkd; else if (fx[to]) got = hkd / fx[to].sell; }
      }
      out.push({ b, got, fx });
    }
    out.sort((x, y) => (y.got ?? -1) - (x.got ?? -1));
    const bestGot = Math.max(...out.map((o) => o.got ?? -1));
    const cur = CCY.slice(1);
    $('#fxTable thead').innerHTML = `<tr><th scope="col">銀行</th><th scope="col" aria-sort="descending">你收到 ${esc(to)}</th><th scope="col">比市場價少</th>${cur.map((c) => `<th scope="col" class="fx-col">${c.name}<br><small>買入／賣出</small></th>`).join('')}</tr>`;
    $('#fxTable tbody').innerHTML = out.length ? out.map(({ b, got, fx }) => {
      const cost = got != null && midOut ? (1 - got / midOut) * 100 : null;
      return `<tr><th scope="row" class="bank-cell"><b>${esc(b.name)}</b><small>${esc(timeAgo(b.fxAt).split('（')[0])}</small></th>
        <td class="cell${got != null && got === bestGot ? ' best' : ''}"><div class="v">${got != null ? fmt(got, dp) : '—'}</div></td>
        <td>${cost != null ? `${cost.toFixed(2)}%` : '—'}</td>
        ${cur.map((c) => `<td class="fx-pair fx-col">${fx[c.code] ? `<span class="v">${fmt(fx[c.code].buy, c.code === 'JPY' ? 5 : 4)}</span><br><span class="v">${fmt(fx[c.code].sell, c.code === 'JPY' ? 5 : 4)}</span>` : '—'}</td>`).join('')}</tr>`;
    }).join('') : '<tr><td colspan="8" class="empty-msg">暫時未讀到銀行牌價。</td></tr>';
  }

  // ---------- 外幣定期計算 ----------
  function bestRate(ccy, tenor) {
    let best = null;
    for (const b of (state.data ? state.data.banks : [])) for (const r of b.deposits || []) {
      if (r.currency !== ccy || r.tenorDays !== tenor || isExpired(r) || (r.conditions || []).includes('需經本行兌換')) continue;
      if (!best || r.rate > best.r.rate) best = { b, r };
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
  function fillTdDefaults() {
    const ccy = $('#tdCcy').value, tenor = +$('#tdTenor').value;
    const best = bestRate(ccy, tenor);
    $('#tdRate').value = best ? best.r.rate : '';
    $('#tdRate').dataset.src = best ? `${best.b.name}${best.r.type === 'promo' ? '優惠，可能有條件' : '牌價'}` : '';
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
    const dp = ccy === 'JPY' ? 0 : 2;
    out.innerHTML = `
      <div class="row"><span>換成${esc(CCY_NAME[ccy])}（已扣差價）</span><b>${esc(ccy)} ${fmt(units, dp)}</b></div>
      <div class="row"><span>${TENOR_LABEL(tenor)}利息・年息 ${pct(rate)}%${src ? `（${esc(src)}）` : ''}</span><b>${esc(ccy)} ${fmt(interest, dp)}</b></div>
      <div class="row"><span>來回換匯成本</span><b class="neg">−HKD ${fmt(fxCost, 0)}</b></div>
      <div class="row total"><span>到期換返港元淨賺</span><b class="${gain >= 0 ? 'pos-c' : 'neg'}">${gain >= 0 ? '+' : '−'}HKD ${fmt(Math.abs(gain), 0)}</b></div>
      <div class="row"><span>折合實際年回報</span><b class="${annual >= 0 ? 'pos-c' : 'neg'}">${annual.toFixed(2)}%</b></div>
      ${hk ? `<div class="row"><span>對比直接做港元${TENOR_LABEL(tenor)}（${esc(hk.b.name)} ${pct(hk.r.rate)}%）</span><b>+HKD ${fmt(hkGain, 0)}</b></div>` : ''}
      <p>到期時${esc(CCY_NAME[ccy])}只要跌多過 <b>${Math.abs(breakeven).toFixed(2)}%</b> 就會蝕本金。${ccy === 'USD' ? '美元同港元掛鈎，匯率波動通常好細，主要成本係換匯差價。' : '呢個貨幣同港元冇掛鈎，匯率升跌可以遠大於利息。'}存期愈短，換匯成本佔回報嘅比例愈大。</p>`;
  }

  // ---------- 走勢 ----------
  const PALETTE = ['var(--accent)', 'var(--promo)'];
  function renderTrend() {
    const h = state.history;
    const el = $('#chart');
    const key = `${state.tCcy}|${state.tTenor}`;
    const series = [];
    if (h && h.series) {
      if (h.series['ALL|' + key]) series.push({ name: '全市場最高（包括有條件優惠）', pts: h.series['ALL|' + key] });
      if (state.tBank && h.series[state.tBank + '|' + key]) {
        const b = state.data.banks.find((x) => x.id === state.tBank);
        series.push({ name: b ? b.name : state.tBank, pts: h.series[state.tBank + '|' + key] });
      }
    }
    const n = series.reduce((a, s) => Math.max(a, s.pts.length), 0);
    if (!series.length || n < 2) {
      el.innerHTML = `<p class="empty-msg">${series.length ? `系統由今日開始記錄，累積幾日數據之後就會畫出走勢。目前${esc(series[0].name)}：${pct(series[0].pts[series[0].pts.length - 1][1])}%` : '暫時未有呢個貨幣／存期嘅紀錄。'}</p>`;
      $('#trendNote').textContent = '';
      return;
    }
    const all = series.flatMap((s) => s.pts);
    const dates = [...new Set(all.map((p) => p[0]))].sort();
    const t0 = Date.parse(dates[0]), t1 = Date.parse(dates[dates.length - 1]) || t0 + 1;
    let lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1]));
    if (hi - lo < 0.2) { hi += 0.1; lo = Math.max(0, lo - 0.1); }
    const W = 760, H = 300, L = 48, R = 14, T = 14, B = 30;
    const x = (d) => L + (Date.parse(d) - t0) / Math.max(t1 - t0, 1) * (W - L - R);
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--ink-2)">${v.toFixed(2)}%</text>`;
    }
    grid += [...new Set([dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]])].map((d) => `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${shortDate(d)}</text>`).join('');
    const paths = series.map((s, i) => {
      let dp = '';
      s.pts.forEach((p, j) => { dp += j === 0 ? `M${x(p[0])},${y(p[1])}` : `H${x(p[0])}V${y(p[1])}`; });
      return `<path d="${dp}" fill="none" stroke="${PALETTE[i]}" stroke-width="2.5" ${i ? 'stroke-dasharray="6 4"' : ''}/>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(CCY_NAME[state.tCcy])} ${TENOR_LABEL(state.tTenor)} 定期息口走勢">${grid}${paths}</svg>
      <div class="legend">${series.map((s, i) => `<span><i style="background:${PALETTE[i]}"></i>${esc(s.name)}</span>`).join('')}</div>`;
    const s0 = series[0].pts;
    const peak = s0.reduce((a, p) => (p[1] > a[1] ? p : a), s0[0]);
    const now = s0[s0.length - 1];
    $('#trendNote').textContent = `由 ${shortDate(s0[0][0])} 開始記錄：最高 ${pct(peak[1])}%（${shortDate(peak[0])}），而家 ${pct(now[1])}%。優惠息口有限期，完結後通常會跌返牌價水平。`;
  }

  // ---------- 資料來源 ----------
  function renderStatus() {
    if (!state.data) return;
    const label = { ok: '正常', stale: '暫時讀唔到，顯示舊數據', none: '暫時未能自動讀取' };
    const order = { ok: 0, stale: 1, none: 2 };
    $('#statusTable tbody').innerHTML = state.data.banks.slice().sort((a, b) => order[a.status] - order[b.status]).map((b) => `<tr>
      <td><b>${esc(b.name)}</b></td>
      <td><span class="dot ${b.status}"></span>${label[b.status] || b.status}</td>
      <td>${b.lastSuccess ? esc(timeAgo(b.lastSuccess)) : '—'}</td>
      <td>${(b.sources || []).slice(0, 4).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">網頁${i + 1}</a>`).join('　') || `<a href="${esc(b.site)}" target="_blank" rel="noopener">官網</a>`}</td>
    </tr>`).join('');
  }

  // ---------- wiring ----------
  function setupTabs() {
    const tabs = document.querySelectorAll('.tabs button');
    const show = (name) => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
      if (location.hash !== '#' + name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
    };
    tabs.forEach((t) => t.addEventListener('click', () => { show(t.dataset.tab); window.scrollTo({ top: 0 }); }));
    const h = location.hash.slice(1);
    if (h && document.getElementById('tab-' + h)) show(h);
  }
  function fillSelect(el, items, val) {
    el.innerHTML = items.map((i) => `<option value="${i.v}">${esc(i.label)}</option>`).join('');
    if (val != null) el.value = val;
  }

  function init() {
    setupTabs();
    setupTable();
    const ccyItems = CCY.map((c) => ({ v: c.code, label: c.name }));
    const tenorItems = TENORS.map((t) => ({ v: t.d, label: t.label }));
    seg($('#ccy'), ccyItems, state.ccy, (v) => { state.ccy = v; state.open = null; save(); renderRates(); });
    seg($('#view'), [{ v: 'rate', label: '年利率' }, { v: 'interest', label: '到期利息' }], state.view, (v) => { state.view = v; save(); renderRates(); });
    $('#amount').value = fmt(state.amount);
    $('#amount').addEventListener('input', () => { state.amount = num($('#amount').value); save(); renderRates(); });
    $('#amount').addEventListener('blur', () => { $('#amount').value = state.amount ? fmt(state.amount) : ''; });
    setupPicker();
    for (const k of ['pFund', 'pFx']) {
      $('#' + k).checked = state[k];
      $('#' + k).onchange = (e) => { state[k] = e.target.checked; save(); renderRates(); };
    }
    $('#share').onclick = async () => {
      const url = shareUrl();
      try { await navigator.clipboard.writeText(url); toast('已複製連結，可以貼落 WhatsApp'); }
      catch { window.prompt('複製呢條連結：', url); }
    };

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

    seg($('#tCcy'), ccyItems, state.tCcy, (v) => { state.tCcy = v; renderTrend(); });
    seg($('#tTenor'), tenorItems, state.tTenor, (v) => { state.tTenor = v; renderTrend(); });
    $('#tBank').onchange = (e) => { state.tBank = e.target.value; renderTrend(); };

    renderRates();
    load();
  }

  async function load() {
    const [data, hist] = await Promise.all([getJson('latest.json'), getJson('history.json'), loadLiveMid()]);
    state.data = data; state.history = hist;
    if (!data) {
      $('#updated').textContent = '暫時讀唔到數據';
      $('#cmp tbody').innerHTML = '<tr><td colspan="6" class="empty-msg">數據檔未準備好，系統第一次更新完成之後就會顯示。</td></tr>';
      return;
    }
    const ok = data.banks.filter((b) => b.status !== 'none').length;
    $('#updated').innerHTML = `更新於 <b>${esc(timeAgo(data.updatedAt))}</b><br>${ok} 間銀行`;
    fillSelect($('#tBank'), [{ v: '', label: '（唔比較）' }, ...data.banks.filter((b) => b.deposits && b.deposits.length).map((b) => ({ v: b.id, label: b.name }))], state.tBank);
    if (state.banks) state.banks = state.banks.filter((id) => data.banks.some((b) => b.id === id));
    renderRates(); renderPicker(); renderFx(); fillTdDefaults(); renderTd(); renderTrend(); renderStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
