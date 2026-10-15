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
  const PREMIUM = /卓越|尊尚|優越|豐盛|Citigold|優先理財|財富|VIP|私人|貴賓|顯卓|至尊|理財金|高級理財|Premier|Prestige|Priority|Treasures|Wealth|Elite/i;
  const GROUP_NAME = { major: '大型銀行', mid: '本地及中資銀行', virtual: '虛擬銀行' };


  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => parseFloat(String(v).replace(/[^\d.\-]/g, '')) || 0;
  const fmt = (v, dp = 0) => Number(v).toLocaleString('en-HK', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const pct = (v) => (Math.round(v * 1000) / 1000).toString();
  const todayHK = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}月${+d}日`; };

  const state = {
    data: null, history: null, liveMid: null,
    ccy: 'HKD', amount: 100000, sort: 90,
    banks: null, // null = all banks, otherwise array of ids to compare
    homeBank: '', // where the money is now ('' = elsewhere) → decides "new funds" per bank
    accounts: [], // banks where the user already has an account → not a new customer there
    premium: [], // banks where the user is a premium-banking customer
    open: null, // "bankId|days" of the expanded cell
    tCcy: 'HKD', tTenor: 90, tBank: '',
  };

  // URL parameters win (shared links), then remembered choices
  try { Object.assign(state, JSON.parse(localStorage.getItem('dep-prefs3') || '{}')); } catch {}
  (function readUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('c') && CCY_NAME[q.get('c')]) state.ccy = q.get('c');
    if (q.get('a')) state.amount = num(q.get('a')) || state.amount;
    if (q.get('t') && TENORS.some((t) => t.d === +q.get('t'))) state.sort = +q.get('t');
    if (q.has('b')) state.banks = q.get('b') ? q.get('b').split(',') : null;
    if (q.has('h')) state.homeBank = q.get('h');
    if (q.has('e')) state.accounts = q.get('e') ? q.get('e').split(',') : [];
    if (q.has('p')) state.premium = q.get('p') ? q.get('p').split(',') : [];
  })();
  const save = () => {
    try { localStorage.setItem('dep-prefs3', JSON.stringify({ ccy: state.ccy, amount: state.amount, sort: state.sort, banks: state.banks, homeBank: state.homeBank, accounts: state.accounts, premium: state.premium })); } catch {}
  };
  function shareUrl() {
    const q = new URLSearchParams({ c: state.ccy, a: String(state.amount), t: String(state.sort) });
    if (state.banks) q.set('b', state.banks.join(','));
    if (state.homeBank) q.set('h', state.homeBank);
    if (state.accounts.length) q.set('e', state.accounts.join(','));
    if (state.premium.length) q.set('p', state.premium.join(','));
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

  // ---------- my situation → what each offer needs ----------
  // Users answer three plain questions; per bank we work out new customer / new funds / premium.
  const isExpired = (r) => r.validUntil && r.validUntil < todayHK();
  const isPremium = (r) => PREMIUM.test([...(r.conditions || []), r.segment || '', r.tier || ''].join(' '));
  const bankName = (id) => { const b = state.data && state.data.banks.find((x) => x.id === id); return b ? b.name : id; };
  const me = (id) => ({
    newCustomer: !state.accounts.includes(id) && !state.premium.includes(id),
    newFunds: state.homeBank !== id,
    premium: state.premium.includes(id),
  });
  // Plain-language list of what an offer needs
  function needs(r) {
    const c = r.conditions || [];
    const out = [];
    if (c.includes('新客戶')) out.push('只限新客戶');
    if (c.includes('新資金')) out.push('要由其他銀行轉錢過嚟');
    if (isPremium(r)) out.push('只限高級理財客戶' + (r.segment && PREMIUM.test(r.segment) ? `（${r.segment}）` : ''));
    if (c.includes('需經本行兌換')) out.push('要先喺呢間銀行換外幣');
    if (c.includes('網上/手機開立')) out.push('要用網上或手機開');
    if (c.includes('只限分行')) out.push('要去分行開');
    if (r.minAmount) out.push(`起存 ${state.ccy} ${fmt(r.minAmount)}`);
    if (c.includes('含獎賞錢等值')) out.push('包括獎賞錢回贈計算');
    if (c.includes('最高息（視乎條件）')) out.push('「高達」息率，實際視乎條件');
    if (r.validUntil) out.push(`優惠至 ${shortDate(r.validUntil)}`);
    return out;
  }
  // Why the user can't get it ('' = can get it)
  function whyNot(r, bankId) {
    const c = r.conditions || [];
    const m = me(bankId);
    if (isExpired(r)) return '優惠已過期';
    if (c.includes('需經本行兌換')) return '要先換外幣，唔係一般定期';
    if (r.minAmount && r.minAmount > state.amount) return `要存 ${state.ccy} ${fmt(r.minAmount)} 或以上`;
    if (!m.newCustomer && c.includes('新客戶')) return '只限新客戶，你已經有戶口';
    if (!m.newFunds && c.includes('新資金')) return '要由其他銀行轉錢過嚟，你筆錢已經喺呢間';
    if (!m.premium && isPremium(r)) return '只限高級理財客戶';
    return '';
  }
  const hasConditions = (r) => r.type === 'promo' || (r.conditions || []).length > 0;

  function cellsFor(b) {
    const mine = (b.deposits || []).filter((r) => r.currency === state.ccy);
    const cells = {};
    for (const t of TENORS) cells[t.d] = mine.filter((r) => r.tenorDays === t.d && !whyNot(r, b.id)).sort((x, y) => y.rate - x.rate)[0] || null;
    return { mine, cells };
  }
  function rowsForTable() {
    const d = state.data;
    const rows = [], noData = [];
    for (const b of d.banks) {
      if (state.banks && !state.banks.includes(b.id)) continue;
      const { mine, cells } = cellsFor(b);
      if (!mine.length) { noData.push(b); continue; }
      rows.push({ b, cells });
    }
    const best = {};
    for (const t of TENORS) best[t.d] = Math.max(0, ...rows.map((r) => (r.cells[t.d] ? r.cells[t.d].rate : 0)));
    const key = (r) => (r.cells[state.sort] ? r.cells[state.sort].rate : -1);
    const maxAny = (r) => Math.max(-1, ...TENORS.map((t) => (r.cells[t.d] ? r.cells[t.d].rate : -1)));
    rows.sort((x, y) => key(y) - key(x) || maxAny(y) - maxAny(x));
    return { rows, noData, best };
  }
  function meLabel(id) {
    const m = me(id);
    const bits = [];
    if (state.homeBank === id) bits.push('錢喺度');
    if (m.premium) bits.push('高級理財'); else if (!m.newCustomer) bits.push('已有戶口');
    return bits.join('・');
  }
  function summaryText() {
    const parts = [];
    parts.push(state.homeBank ? `筆錢喺${esc(bankName(state.homeBank))}` : '筆錢由其他銀行轉過嚟');
    parts.push(state.accounts.length ? `已有戶口：${state.accounts.map((x) => esc(bankName(x))).join('、')}` : '全部當新客戶');
    if (state.premium.length) parts.push(`高級理財：${state.premium.map((x) => esc(bankName(x))).join('、')}`);
    return `按你嘅情況計：${parts.join('；')}。要先換外幣先有嘅短期高息唔計入表。`;
  }

  // ---------- 定期比較 ----------
  function renderRates() {
    $('#amt-ccy').textContent = state.ccy;
    $('#meSummary').innerHTML = state.data ? summaryText() : '';
    $('#tenorSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(+x.dataset.v === state.sort)));
    const thead = $('#cmp thead'), tbody = $('#cmp tbody');
    thead.innerHTML = `<tr><th scope="col">銀行</th>${TENORS.map((t) => `<th scope="col" class="sortable" data-d="${t.d}" ${t.d === state.sort ? 'aria-sort="descending"' : ''}>${t.label}${t.d === state.sort ? '<span class="arrow">▼</span>' : ''}</th>`).join('')}</tr>`;
    if (!state.data) { tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">讀取緊數據…</td></tr>'; $('#rank').innerHTML = '<li class="empty-msg">讀取緊數據…</li>'; return; }
    const { rows, noData, best } = rowsForTable();
    $('#caption').innerHTML = `${esc(CCY_NAME[state.ccy])}定期・存 <b>${state.ccy} ${fmt(state.amount)}</b>・數字係你攞到嘅最高年利率，撳入去睇條件同其他選擇。`;

    // wide screens: bank × tenor table
    const html = [];
    for (const { b, cells } of rows) {
      const tag = meLabel(b.id);
      const stale = b.status === 'stale' ? `<small class="stale">數據截至 ${esc(timeAgo(b.lastSuccess).split('（')[0])}</small>` : '';
      html.push(`<tr><th scope="row" class="bank-cell"><b>${esc(b.name)}</b>${tag ? `<small class="me-tag">${tag}</small>` : ''}${stale}</th>${TENORS.map((t) => {
        const r = cells[t.d];
        const k = `${b.id}|${t.d}`;
        const open = state.open === k;
        if (!r) return `<td class="cell empty${open ? ' open' : ''}" data-k="${k}" tabindex="0" role="button" aria-expanded="${open}" aria-label="${esc(b.name)} ${t.label}：你暫時冇合適息口，撳睇其他選擇">—</td>`;
        const isBest = r.rate === best[t.d] && best[t.d] > 0;
        return `<td class="cell${isBest ? ' best' : ''}${open ? ' open' : ''}" data-k="${k}" tabindex="0" role="button" aria-expanded="${open}" aria-label="${esc(b.name)} ${t.label} ${pct(r.rate)}%${hasConditions(r) ? '，有條件' : ''}，撳睇詳情">
          <span class="v">${pct(r.rate)}<small>%</small></span>${hasConditions(r) ? '<i class="dot-cond" aria-hidden="true"></i>' : ''}</td>`;
      }).join('')}</tr>`);
      if (state.open && state.open.startsWith(b.id + '|')) html.push(`<tr class="detail"><td colspan="6">${detailHtml(b, +state.open.split('|')[1])}</td></tr>`);
    }
    if (!rows.length) html.push(`<tr><td colspan="6" class="empty-msg">${state.banks ? '你揀嘅銀行未有呢個貨幣嘅定期數據，撳「揀銀行」加多幾間。' : '暫時未有數據。'}</td></tr>`);
    if (noData.length) html.push(`<tr class="group"><td colspan="6">未有${esc(CCY_NAME[state.ccy])}定期數據：${noData.map((b) => esc(b.name)).join('、')}</td></tr>`);
    tbody.innerHTML = html.join('');

    // phones: ranking for the chosen tenor
    const ranked = rows.filter((x) => x.cells[state.sort]).sort((x, y) => y.cells[state.sort].rate - x.cells[state.sort].rate);
    const none = rows.filter((x) => !x.cells[state.sort]);
    const days = DAYS(state.sort);
    $('#rank').innerHTML = ranked.map(({ b, cells }, i) => {
      const r = cells[state.sort];
      const k = `${b.id}|${state.sort}`;
      const open = state.open === k;
      const tag = meLabel(b.id);
      return `<li class="rk${i === 0 ? ' best' : ''}${open ? ' open' : ''}">
        <button type="button" class="rk-head" data-k="${k}" aria-expanded="${open}">
          <span class="rk-pos">${i + 1}</span>
          <span class="rk-name"><b>${esc(b.name)}</b><small>${tag ? tag + '・' : ''}利息 ≈ ${state.ccy} ${fmt(state.amount * r.rate / 100 * days / 365, 0)}</small></span>
          <span class="rk-rate">${pct(r.rate)}<small>%</small>${hasConditions(r) ? '<i class="dot-cond" aria-hidden="true"></i>' : ''}</span>
        </button>
        ${open ? `<div class="rk-detail">${detailHtml(b, state.sort)}</div>` : ''}
      </li>`;
    }).join('') + (none.length ? `<li class="rk-none">${TENOR_LABEL(state.sort)}暫時冇合適息口：${none.map((x) => esc(x.b.name)).join('、')}</li>` : '');
  }

  function detailHtml(b, days) {
    const all = (b.deposits || []).filter((r) => r.currency === state.ccy && r.tenorDays === days && !isExpired(r)).sort((x, y) => y.rate - x.rate);
    const ok = all.filter((r) => !whyNot(r, b.id));
    const no = all.filter((r) => whyNot(r, b.id));
    const interest = (r) => fmt(state.amount * r.rate / 100 * DAYS(days) / 365, state.ccy === 'JPY' ? 0 : 0);
    const item = (r, bad) => {
      const n = needs(r);
      return `<li class="offer${bad ? ' no' : ''}">
        <div><b class="o-rate">${pct(r.rate)}%</b> <span class="o-kind">${r.type === 'promo' ? '優惠' : '牌價'}</span>
          <div class="o-needs">${n.length ? n.map(esc).join('・') : '冇特別條件'}</div>
          ${bad ? `<div class="o-why">你未符合：${esc(whyNot(r, b.id))}</div>` : ''}</div>
        <div class="o-int">${state.ccy} ${interest(r)}<small>到期利息</small></div>
      </li>`;
    };
    const dedupe = (list) => { const s = new Set(); return list.filter((r) => { const k = r.rate + '|' + needs(r).join(); if (s.has(k)) return false; s.add(k); return true; }); };
    // what you get: the best one, plus the plain board rate when the best is an offer
    const okL = [];
    if (ok[0]) okL.push(ok[0]);
    const board = ok.find((r) => r.type !== 'promo');
    if (ok[0] && ok[0].type === 'promo' && board) okL.push(board);
    // other choices: only those paying more than what you get now
    const floor = ok[0] ? ok[0].rate : 0;
    const noL = dedupe(no.filter((r) => r.rate > floor)).slice(0, 4);
    const src = (all[0] && all[0].url) || (b.sources || [])[0] || b.site;
    return `<div class="detail-in">
      <div class="d-head"><h3>${esc(b.name)}・${esc(CCY_NAME[state.ccy])} ${TENOR_LABEL(days)}</h3><button class="btn small" type="button" data-close>收起</button></div>
      ${okL.length ? `<p class="d-sub">你攞到</p><ul class="offers">${okL.map((r) => item(r, false)).join('')}</ul>` : '<p class="d-sub">按你嘅情況，呢個存期暫時冇合適息口。</p>'}
      ${noL.length ? `<p class="d-sub">其他選擇（你暫時未符合）</p><ul class="offers">${noL.map((r) => item(r, true)).join('')}</ul>` : ''}
      <p class="d-foot"><a href="${esc(src)}" target="_blank" rel="noopener">睇銀行原文及條款</a>・數據時間 ${esc(timeAgo(b.lastSuccess))}</p>
    </div>`;
  }

  function setupTable() {
    const toggle = (k) => {
      if (!k) return;
      state.open = state.open === k ? null : k;
      renderRates();
      const again = document.querySelector(`[data-k="${state.open}"]`);
      if (again && window.matchMedia('(max-width: 720px)').matches === !!again.closest('#rank')) again.focus({ preventScroll: true });
    };
    for (const root of [$('#cmp'), $('#rank')]) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        if (e.target.closest('[data-close]')) { state.open = null; renderRates(); return; }
        const th = e.target.closest('th.sortable');
        if (th) { state.sort = +th.dataset.d; save(); renderRates(); return; }
        const el = e.target.closest('[data-k]');
        if (el) toggle(el.dataset.k);
      });
    }
    $('#cmp').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('td.cell')) { e.preventDefault(); toggle(e.target.dataset.k); }
    });
  }

  // ---------- 我嘅情況 / 揀銀行 panels ----------
  function bankChips(el, list, onToggle) {
    const banks = state.data ? state.data.banks.filter((b) => b.deposits && b.deposits.length) : [];
    el.innerHTML = banks.map((b) => `<button type="button" class="chip" aria-pressed="${list.includes(b.id)}" data-id="${b.id}">${esc(b.name)}</button>`).join('');
    el.onclick = (e) => { const c = e.target.closest('.chip'); if (c) onToggle(c.dataset.id); };
  }
  function renderMe() {
    if (!state.data) return;
    const banks = state.data.banks.filter((b) => b.deposits && b.deposits.length);
    $('#homeBank').innerHTML = `<option value="">唔喺以下銀行／未決定</option>` + banks.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    $('#homeBank').value = state.homeBank || '';
    const flip = (key) => (id) => { const l = state[key]; state[key] = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]; changed(); };
    bankChips($('#accChips'), state.accounts, flip('accounts'));
    bankChips($('#premChips'), state.premium, flip('premium'));
    const set = state.homeBank || state.accounts.length || state.premium.length;
    $('#meBtn').textContent = set ? '修改我嘅情況' : '設定我嘅情況';
  }
  function changed() { save(); renderMe(); renderRates(); }
  function pickerLabel() {
    const total = state.data ? state.data.banks.length : 0;
    $('#pickerBtn').textContent = state.banks ? `揀銀行（${state.banks.length}／${total}）` : '揀銀行';
  }
  function renderPicker() {
    pickerLabel();
    if (!state.data) return;
    const groups = {};
    for (const b of state.data.banks) (groups[b.group] = groups[b.group] || []).push(b);
    $('#pickerList').innerHTML = Object.entries(GROUP_NAME).filter(([g]) => groups[g]).map(([g, name]) => `
      <div class="pg"><h4>${name}</h4><div class="chips">${groups[g].map((b) => {
        const on = !state.banks || state.banks.includes(b.id);
        const has = b.deposits && b.deposits.length;
        return `<button type="button" class="chip${has ? '' : ' nodata'}" aria-pressed="${on}" data-pick="${b.id}" ${has ? '' : 'title="暫未有數據"'}>${esc(b.name)}</button>`;
      }).join('')}</div></div>`).join('');
  }
  function setupPanels() {
    const pairs = [[$('#meBtn'), $('#mePanel')], [$('#pickerBtn'), $('#picker')]];
    for (const [btn, panel] of pairs) {
      btn.onclick = () => {
        const open = panel.hidden;
        for (const [b2, p2] of pairs) { p2.hidden = true; b2.setAttribute('aria-expanded', 'false'); }
        panel.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      };
    }
    $('#meDone').onclick = () => { $('#mePanel').hidden = true; $('#meBtn').setAttribute('aria-expanded', 'false'); toast('已按你嘅情況更新'); };
    $('#meReset').onclick = () => { state.homeBank = ''; state.accounts = []; state.premium = []; changed(); };
    $('#homeBank').onchange = (e) => { state.homeBank = e.target.value; changed(); };
    $('#pickerDone').onclick = () => { $('#picker').hidden = true; $('#pickerBtn').setAttribute('aria-expanded', 'false'); };
    $('#picker').addEventListener('click', (e) => {
      const c = e.target.closest('[data-pick]');
      const p = e.target.closest('[data-preset]');
      const all = state.data.banks.map((b) => b.id);
      if (c) {
        let sel = state.banks ? [...state.banks] : [...all];
        sel = sel.includes(c.dataset.pick) ? sel.filter((x) => x !== c.dataset.pick) : [...sel, c.dataset.pick];
        state.banks = sel.length === all.length ? null : sel;
      } else if (p) {
        const v = p.dataset.preset;
        state.banks = v === 'all' ? null : v === 'none' ? [] : state.data.banks.filter((b) => b.group === v).map((b) => b.id);
      } else return;
      save(); renderPicker(); renderRates();
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
    seg($('#tenorSeg'), tenorItems, state.sort, (v) => { state.sort = v; state.open = null; save(); renderRates(); });
    $('#amount').value = fmt(state.amount);
    $('#amount').addEventListener('input', () => { state.amount = num($('#amount').value); save(); renderRates(); });
    $('#amount').addEventListener('blur', () => { $('#amount').value = state.amount ? fmt(state.amount) : ''; });
    setupPanels();
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
    renderMe(); renderPicker(); renderRates(); renderFx(); fillTdDefaults(); renderTd(); renderTrend(); renderStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
