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
    if (r.minAmount == null) out.push('起存額未有資料，請睇原文');
    else if (r.minAmount > 0) out.push(`起存 ${r.currency || state.ccy} ${fmt(r.minAmount)}`);
    if (r.maxAmount) out.push(`最多只計 ${r.currency || state.ccy} ${fmt(r.maxAmount)}`);
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
    if (r.maxAmount && state.amount > r.maxAmount) return `最多只可以存 ${state.ccy} ${fmt(r.maxAmount)}，你輸入嘅金額超出咗`;
    if (r.minAmount == null && hkdValue(state.amount, state.ccy) < TYPICAL_MIN_HKD) return `起存額未有資料，大部分銀行要 HKD ${fmt(TYPICAL_MIN_HKD)} 或以上`;
    if (!m.newCustomer && c.includes('新客戶')) return '只限新客戶，你已經有戶口';
    if (!m.newFunds && c.includes('新資金')) return '要由其他銀行轉錢過嚟，你筆錢已經喺呢間';
    if (!m.premium && isPremium(r)) return '只限高級理財客戶';
    return '';
  }
  // a few words for an empty cell: why the rates this bank does have don't apply to you
  function shortWhy(w) {
    if (!w) return '';
    if (/高級理財/.test(w)) return '只限理財客戶';
    if (/新客戶/.test(w)) return '只限新客戶';
    if (/其他銀行轉錢/.test(w)) return '只限新資金';
    if (/最多只可以存/.test(w)) return '金額超出上限';
    const m = w.match(/要存 (\S+) ([\d,]+)/); if (m) return `${m[2]} 起`;
    if (/起存額未有資料/.test(w)) return '起存額未知';
    if (/換外幣/.test(w)) return '要先換外幣';
    return '有條件';
  }
  // most banks need about HKD 10,000 for a time deposit; used when a rate's minimum is unknown
  const TYPICAL_MIN_HKD = 10000;
  const hkdValue = (amt, ccy) => (ccy === 'HKD' ? amt : amt * (mid().rates[ccy] || 0));
  const hasConditions = (r) => r.type === 'promo' || (r.conditions || []).length > 0;

  function cellsFor(b) {
    const mine = (b.deposits || []).filter((r) => r.currency === state.ccy);
    const cells = {};
    const blocked = {};
    for (const t of TENORS) {
      const here = mine.filter((r) => r.tenorDays === t.d && !isExpired(r));
      cells[t.d] = here.filter((r) => !whyNot(r, b.id)).sort((x, y) => y.rate - x.rate)[0] || null;
      if (!cells[t.d] && here.length) blocked[t.d] = shortWhy(whyNot(here.sort((x, y) => y.rate - x.rate)[0], b.id));
    }
    return { mine, cells, blocked };
  }
  function rowsForTable() {
    const d = state.data;
    const rows = [], noData = [];
    for (const b of d.banks) {
      if (state.banks && !state.banks.includes(b.id)) continue;
      const { mine, cells, blocked } = cellsFor(b);
      if (!mine.length) { noData.push(b); continue; }
      rows.push({ b, cells, blocked });
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
    const small = hkdValue(state.amount, state.ccy) < TYPICAL_MIN_HKD;
    $('#caption').innerHTML = `${esc(CCY_NAME[state.ccy])}定期・存 <b>${state.ccy} ${fmt(state.amount)}</b>・數字係你攞到嘅最高年利率，已計各銀行起存額，撳入去睇條件同其他選擇。`
      + (small ? `<span class="warn-line">大部分銀行定期要 HKD ${fmt(TYPICAL_MIN_HKD)} 或等值起存，金額太細可能做唔到；起存額未有資料嘅息口暫時唔計。</span>` : '');

    // wide screens: bank × tenor table
    const html = [];
    let rowNo = 0;
    for (const { b, cells, blocked } of rows) {
      const alt = rowNo++ % 2 ? ' class="alt"' : '';
      const tag = meLabel(b.id);
      const promoLink = b.promoUrl ? `<a class="promo-link" href="${esc(b.promoUrl)}" target="_blank" rel="noopener">優惠請睇銀行網站 ↗</a>` : '';
      const stale = b.status === 'stale' ? `<small class="stale">數據截至 ${esc(timeAgo(b.lastSuccess).split('（')[0])}</small>` : '';
      html.push(`<tr${alt}><th scope="row" class="bank-cell"><b>${esc(b.name)}</b>${tag ? `<small class="me-tag">${tag}</small>` : ''}${stale}${promoLink}</th>${TENORS.map((t) => {
        const r = cells[t.d];
        const k = `${b.id}|${t.d}`;
        const open = state.open === k;
        if (!r) return `<td class="cell empty${open ? ' open' : ''}" data-k="${k}" tabindex="0" role="button" aria-expanded="${open}" aria-label="${esc(b.name)} ${t.label}：${blocked[t.d] ? esc(blocked[t.d]) : '你暫時冇合適息口'}，撳睇其他選擇">—${blocked[t.d] ? `<small class="why">${esc(blocked[t.d])}</small>` : ''}</td>`;
        const isBest = r.rate === best[t.d] && best[t.d] > 0;
        return `<td class="cell${isBest ? ' best' : ''}${open ? ' open' : ''}" data-k="${k}" tabindex="0" role="button" aria-expanded="${open}" aria-label="${esc(b.name)} ${t.label} ${pct(r.rate)}%${hasConditions(r) ? '，有條件' : ''}，撳睇詳情">
          <span class="v">${pct(r.rate)}<small>%</small></span>${hasConditions(r) ? '<i class="dot-cond" aria-hidden="true"></i>' : ''}${kindTag(r)}</td>`;
      }).join('')}</tr>`);
      if (state.open && state.open.startsWith(b.id + '|')) html.push(`<tr class="detail${alt ? ' alt' : ''}"><td colspan="6">${detailHtml(b, +state.open.split('|')[1])}</td></tr>`);
    }
    if (!rows.length) html.push(`<tr><td colspan="6" class="empty-msg">${state.banks ? '你揀嘅銀行未有呢個貨幣嘅定期數據，撳「揀銀行」加多幾間。' : '暫時未有數據。'}</td></tr>`);
    const nd = $('#noDataNote');
    if (nd) nd.innerHTML = noData.length
      ? `<b>以下銀行嘅網頁搵唔到${esc(CCY_NAME[state.ccy])}定期息口</b>（可能冇提供呢種貨幣，亦可能係系統暫時讀唔到），可以撳名去銀行網站確認：${noData.map((b) => `<a href="${esc((b.sources && b.sources[0]) || b.site)}" target="_blank" rel="noopener">${esc(b.name)}</a>`).join('、')}`
      : '';
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
          <span class="rk-name"><b>${esc(b.name)}</b>${b.promoUrl ? '<small class="promo-note">優惠未能自動讀取，請睇銀行網站</small>' : ''}<small>${tag ? tag + '・' : ''}利息 ≈ ${state.ccy} ${fmt(state.amount * r.rate / 100 * days / 365, 0)}・${r.minAmount == null ? '起存額未知' : r.minAmount > 0 ? `${fmt(r.minAmount)} 起` : '冇起存要求'}</small></span>
          <span class="rk-rate">${pct(r.rate)}<small>%</small>${hasConditions(r) ? '<i class="dot-cond" aria-hidden="true"></i>' : ''}${kindTag(r)}</span>
        </button>
        ${open ? `<div class="rk-detail">${detailHtml(b, state.sort)}</div>` : ''}
      </li>`;
    }).join('') + (none.length ? `<li class="rk-none">${TENOR_LABEL(state.sort)}暫時冇合適息口：${none.map((x) => esc(x.b.name) + (x.blocked[state.sort] ? `（${esc(x.blocked[state.sort])}）` : '')).join('、')}</li>` : '');
  }

  // promo vs board at a glance
  const kindTag = (r) => (r.type === 'promo' ? '<span class="kind promo">優惠</span>' : '<span class="kind board">牌價</span>');
  function detailHtml(b, days) {
    const all = (b.deposits || []).filter((r) => r.currency === state.ccy && r.tenorDays === days && !isExpired(r)).sort((x, y) => y.rate - x.rate);
    const ok = all.filter((r) => !whyNot(r, b.id));
    const no = all.filter((r) => whyNot(r, b.id));
    const interest = (r) => fmt(state.amount * r.rate / 100 * DAYS(days) / 365, state.ccy === 'JPY' ? 0 : 0);
    const item = (r, bad) => {
      const n = needs(r);
      return `<li class="offer${bad ? ' no' : ''}">
        <div><b class="o-rate">${pct(r.rate)}%</b> <span class="o-kind">${r.type === 'promo' ? '推廣優惠' : '牌價（銀行標準息口）'}</span>
          <div class="o-needs">${n.length ? n.map(esc).join('・') : '冇特別條件'}</div>
          ${r.url ? `<a class="o-src" href="${esc(r.url)}" target="_blank" rel="noopener">出處：${r.type === 'promo' ? '銀行優惠頁' : '銀行存款利率表'}</a>` : ''}
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
    return `<div class="detail-in">
      <div class="d-head"><h3>${esc(b.name)}・${esc(CCY_NAME[state.ccy])} ${TENOR_LABEL(days)}</h3><button class="btn small" type="button" data-close>收起</button></div>
      ${okL.length ? `<p class="d-sub">你攞到</p><ul class="offers">${okL.map((r) => item(r, false)).join('')}</ul>` : '<p class="d-sub">按你嘅情況，呢個存期暫時冇合適息口。</p>'}
      ${noL.length ? `<p class="d-sub">其他選擇（你暫時未符合）</p><ul class="offers">${noL.map((r) => item(r, true)).join('')}</ul>` : ''}
      <p class="d-foot">牌價係銀行存款利率表上嘅標準息口，冇任何優惠時都適用；優惠只會喺銀行列明嘅存期提供。數據時間 ${esc(timeAgo(b.lastSuccess))}</p>
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
    const chip = (b) => `<button type="button" class="chip" aria-pressed="${list.includes(b.id)}" data-id="${b.id}">${esc(b.name)}</button>`;
    const first = banks.filter((b) => b.group === 'major' || list.includes(b.id));
    const rest = banks.filter((b) => !first.includes(b));
    const open = el.dataset.more === '1' || !rest.length;
    el.innerHTML = (open ? banks : first).map(chip).join('')
      + (rest.length ? `<button type="button" class="chip more" data-more>${open ? '收埋' : `顯示其他 ${rest.length} 間（中型及虛擬銀行）`}</button>` : '');
    el.onclick = (e) => {
      if (e.target.closest('[data-more]')) { el.dataset.more = open ? '' : '1'; bankChips(el, list, onToggle); return; }
      const c = e.target.closest('.chip'); if (c) onToggle(c.dataset.id);
    };
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
  function changed() { save(); renderMe(); renderRates(); renderTd(); }
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
        return `<button type="button" class="chip${has ? '' : ' nodata'}" aria-pressed="${on}" data-pick="${b.id}" ${has ? '' : 'title="系統暫時讀唔到呢間銀行嘅網頁"'}>${esc(b.name)}${has ? '' : '<small>（暫時讀唔到）</small>'}</button>`;
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
  // Every bank is priced with its own TT rates and its own deposit rate.
  const td = { ccy: 'USD', tenor: 90, open: null };
  function medianSpread(ccy) {
    const m = mid().rates[ccy]; if (!m) return 0.004;
    const s = [];
    for (const b of (state.data ? state.data.banks : [])) { const f = (b.fx || {})[ccy]; if (f && f.sell > f.buy) s.push((f.sell - f.buy) / 2 / m); }
    if (!s.length) return 0.004;
    s.sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }
  // offers the user can get in a foreign currency (converting is the whole point here, so
  // "convert-and-deposit" offers count); minimum amounts are compared in that currency
  function bestForeign(b, ccy, tenor, units) {
    return (b.deposits || []).filter((r) => {
      if (r.currency !== ccy || r.tenorDays !== tenor || isExpired(r)) return false;
      const c = r.conditions || []; const m = me(b.id);
      if (r.minAmount && r.minAmount > units) return false;
      if (r.maxAmount && units > r.maxAmount) return false;
      if (r.minAmount == null && hkdValue(units, ccy) < TYPICAL_MIN_HKD) return false;
      if (!m.newCustomer && c.includes('新客戶')) return false;
      if (!m.newFunds && c.includes('新資金')) return false;
      if (!m.premium && isPremium(r)) return false;
      return true;
    }).sort((x, y) => y.rate - x.rate)[0] || null;
  }
  // same bank, plain HKD deposit, for the like-for-like comparison
  function hkdAt(b, tenor, amt) {
    const save = state.amount, saveCcy = state.ccy; state.amount = amt; state.ccy = 'HKD';
    const r = (b.deposits || []).filter((x) => x.currency === 'HKD' && x.tenorDays === tenor && !whyNot(x, b.id)).sort((x, y) => y.rate - x.rate)[0] || null;
    state.amount = save; state.ccy = saveCcy;
    return r;
  }
  const money = (v) => fmt(Math.round(v), 0);
  const chip = (g) => `<span class="chip-g ${g >= 0 ? 'up' : 'dn'}">${g >= 0 ? '賺' : '蝕'} ${money(Math.abs(g))}</span>`;
  function renderTd() {
    const amt = num($('#tdAmt').value), ccy = td.ccy, tenor = td.tenor;
    const list = $('#tdList');
    const m = mid().rates[ccy];
    if (!state.data || !m || !amt) { list.innerHTML = '<li class="empty-msg">未有匯價數據，暫時計唔到。</li>'; return; }
    const days = DAYS(tenor), sp = medianSpread(ccy);
    const mine = state.accounts.length || state.homeBank;
    $('#tdMineWrap').hidden = !mine;
    const onlyMine = mine && $('#tdMine').checked;
    const myBanks = new Set([...state.accounts, ...state.premium, state.homeBank].filter(Boolean));
    $('#tdBase').innerHTML = `你放 <b>HKD ${money(amt)}</b> 做${esc(CCY_NAME[ccy])}定期 ${TENOR_LABEL(tenor)}，到期換返港幣攞返幾多？（按今日匯率計）`;
    const rows = [];
    for (const b of state.data.banks) {
      if (onlyMine && !myBanks.has(b.id)) continue;
      const f = (b.fx || {})[ccy];
      const sell = f ? f.sell : m * (1 + sp), buy = f ? f.buy : m * (1 - sp);
      const units = amt / sell;
      const r = bestForeign(b, ccy, tenor, units);
      if (!r) continue;
      const interest = units * r.rate / 100 * days / 365;
      const back = (units + interest) * buy;
      const hk = hkdAt(b, tenor, amt);
      rows.push({ b, r, f, units, back, gain: back - amt,
        interestHkd: interest * buy, fxCost: amt - units * buy,
        breakeven: (amt / ((units + interest) * buy) - 1) * 100,
        hk, hkBack: hk ? amt + amt * hk.rate / 100 * days / 365 : null });
    }
    rows.sort((x, y) => y.gain - x.gain);
    if (!rows.length) { list.innerHTML = `<li class="empty-msg">${onlyMine ? '你有戶口嘅銀行' : '暫時未有銀行'}未有${esc(CCY_NAME[ccy])}${TENOR_LABEL(tenor)}定期息口${onlyMine ? '，可以取消「只睇我有戶口嘅銀行」' : '，試吓揀另一個存期'}。</li>`; return; }
    list.innerHTML = rows.map((x, i) => {
      const k = x.b.id, open = td.open === k;
      const n = needs(x.r);
      const cmp = x.hk
        ? `同一間改做港元定期：攞返 HKD ${money(x.hkBack)}，${x.hkBack > x.back ? `比做${esc(CCY_NAME[ccy])}多 ${money(x.hkBack - x.back)}` : x.hkBack < x.back ? `比做${esc(CCY_NAME[ccy])}少 ${money(x.back - x.hkBack)}` : '兩者一樣'}`
        : '呢間未有合適嘅港元同期定期資料';
      return `<li class="rk${open ? ' open' : ''}">
        <button type="button" class="rk-head" data-td="${k}" aria-expanded="${open}">
          <span class="rk-pos">${i + 1}</span>
          <span class="rk-name"><b>${esc(x.b.name)}</b><small>${esc(CCY_NAME[ccy])}年息 ${pct(x.r.rate)}%${x.f ? '' : '・換錢價估算'}</small><small class="cmp">${cmp}</small></span>
          <span class="rk-back"><small>到期攞返</small><b>HKD ${money(x.back)}</b>${chip(x.gain)}</span>
        </button>
        ${open ? `<div class="rk-detail"><div class="detail-in">
          <p class="risk-line">${esc(CCY_NAME[ccy])}只要喺到期前跌多過 ${Math.abs(x.breakeven).toFixed(2)}%，你就會攞返少過 HKD ${money(amt)}。${ccy === 'USD' ? '美元同港元掛鈎，波動通常好細。' : ''}</p>
          <p class="o-needs">${n.length ? '要留意：' + n.map(esc).join('・') : '冇特別條件'}</p>
          <details class="how-wrap"><summary>點計出嚟？</summary>
            <ul class="how">
              <li><span>利息（${esc(CCY_NAME[ccy])} ${fmt(x.units * x.r.rate / 100 * days / 365, ccy === 'JPY' ? 0 : 2)}）</span><b>約 + HKD ${money(x.interestHkd)}</b></li>
              <li><span>換錢差價（買一次、賣一次，銀行收）</span><b>約 − HKD ${money(x.fxCost)}</b></li>
              <li><span>${x.gain >= 0 ? '淨賺' : '淨蝕'}</span><b>${x.gain >= 0 ? '+' : '−'} HKD ${money(Math.abs(x.gain))}</b></li>
            </ul>
          </details>
          <p class="d-foot"><a href="${esc(x.r.url || x.b.site)}" target="_blank" rel="noopener">睇銀行原文及條款</a></p>
        </div></div>` : ''}
      </li>`;
    }).join('');
  }
  function setupTd() {
    seg($('#tdCcy'), CCY.slice(1).map((c) => ({ v: c.code, label: c.name })), td.ccy, (v) => { td.ccy = v; td.open = null; renderTd(); });
    seg($('#tdTenor'), TENORS.map((t) => ({ v: t.d, label: t.label })), td.tenor, (v) => { td.tenor = v; td.open = null; renderTd(); });
    $('#tdAmt').addEventListener('input', () => { renderTd(); amountWarn($('#tdAmt'), num($('#tdAmt').value)); });
    amountBox($('#tdAmt'));
    $('#tdAmt').addEventListener('blur', () => { $('#tdAmt').value = fmt(num($('#tdAmt').value)); });
    $('#tdMine').addEventListener('change', renderTd);
    $('#tdList').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const h = e.target.closest('[data-td]'); if (!h) return;
      td.open = td.open === h.dataset.td ? null : h.dataset.td; renderTd();
    });
  }

  // ---------- 走勢 (HKMA monthly history) ----------
  const trend = { years: window.matchMedia('(max-width: 560px)').matches ? 10 : 20, tenor: 3, hkma: null };
  const TT = { 1: '1個月', 3: '3個月', 6: '6個月', 12: '12個月' };
  const ym = (m) => { const [y, mo] = m.split('-'); return `${y}年${+mo}月`; };
  function renderTrend() {
    const el = $('#chart');
    const h = trend.hkma;
    if (!h || !h.months || !h.months.length) {
      el.innerHTML = '<p class="empty-msg">歷史數據準備緊，下次系統更新（大約兩個鐘內）就會出現。</p>';
      $('#trendFacts').innerHTML = ''; $('#trendNote').textContent = '';
      return;
    }
    const last = h.months[h.months.length - 1][0];
    const from = trend.years ? `${+last.slice(0, 4) - trend.years}${last.slice(4)}` : '0000';
    const pts = h.months.filter(([m]) => m > from);
    const series = [
      { name: `銀行定期牌價 ${TT[trend.tenor]}（金管局：主要銀行平均）`, key: 'd' + trend.tenor, color: 'var(--accent)' },
      { name: `參考：HIBOR ${TT[trend.tenor]}（唔係定期息率）`, key: 'h' + trend.tenor, color: 'var(--ink-3)', dash: true },
    ].map((sr) => ({ ...sr, pts: pts.filter(([, v]) => v[sr.key] != null).map(([m, v]) => [m, v[sr.key]]) }));
    const all = series.flatMap((s) => s.pts.map((p) => p[1]));
    if (!all.length) { el.innerHTML = '<p class="empty-msg">呢個存期暫時冇數據。</p>'; return; }
    const lo = 0, hi = Math.max(1, Math.ceil(Math.max(...all)));
    const narrow = window.matchMedia('(max-width: 560px)').matches;
    const W = narrow ? 400 : 760, H = narrow ? 300 : 320, L = narrow ? 36 : 44, R = narrow ? 8 : 14, T = 14, B = 30;
    const fs = narrow ? 12 : 11;
    const months = pts.map((p) => p[0]);
    const xi = (m) => months.indexOf(m);
    const x = (m) => L + xi(m) / Math.max(months.length - 1, 1) * (W - L - R);
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    let grid = '';
    const step = hi <= 2 ? 0.5 : hi <= 6 ? 1 : 2;
    for (let v = 0; v <= hi + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="${fs}" fill="var(--ink-2)">${v}%</text>`;
    const yearsShown = [...new Set(months.map((m) => m.slice(0, 4)))];
    const every = Math.ceil(yearsShown.length / (narrow ? 5 : 8));
    yearsShown.forEach((yr, i) => { if (i % every) return; const m = months.find((mm) => mm.startsWith(yr)); grid += `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" font-size="${fs}" fill="var(--ink-2)">${yr}</text>`; });
    const paths = series.map((sr) => `<path d="${sr.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${sr.color}" stroke-width="${sr.dash ? 1.6 : 2.2}" ${sr.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`
).join('');
    el.innerHTML = `<div class="readout" id="readout">移動或者撳圖表睇每個月嘅數字</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="港元 ${TT[trend.tenor]} 息口走勢">${grid}${paths}<line id="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" stroke-dasharray="3 3" visibility="hidden"/></svg>
      <div class="legend">${series.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
    const svg = el.querySelector('svg');
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
      const i = Math.max(0, Math.min(months.length - 1, Math.round((px - L) / (W - L - R) * (months.length - 1))));
      const m = months[i], v = pts[i][1];
      const c = svg.querySelector('#cross'); c.setAttribute('x1', x(m)); c.setAttribute('x2', x(m)); c.setAttribute('visibility', 'visible');
      $('#readout').innerHTML = `<b>${ym(m)}</b>　牌價平均 ${v['d' + trend.tenor] != null ? v['d' + trend.tenor].toFixed(2) + '%' : '—'}　<span class="ref">HIBOR ${v['h' + trend.tenor] != null ? v['h' + trend.tenor].toFixed(2) + '%' : '—'}</span>`;
    };
    svg.addEventListener('mousemove', show); svg.addEventListener('click', show); svg.addEventListener('touchmove', show, { passive: true });

    // plain-language facts for the chosen period, each labelled with its line and its month(s)
    const stat = (sp) => {
      if (!sp.length) return null;
      const mx = sp.reduce((a, p) => (p[1] > a[1] ? p : a)), mn = sp.reduce((a, p) => (p[1] < a[1] ? p : a));
      return { avg: sp.reduce((a, p) => a + p[1], 0) / sp.length, mx, mn, now: sp[sp.length - 1], first: sp[0][0] };
    };
    const bs = stat(series[0].pts), hb = stat(series[1].pts);
    if (bs) {
      const pc = (v) => v.toFixed(2) + '%';
      const nr = window.matchMedia('(max-width: 560px)').matches;
      const dm = (m) => (nr ? m.replace('-', '/') : ym(m));
      const row = (st, label, cls) => st ? `<tr class="${cls}"><th scope="row"><i></i>${label}</th>
        <td><b>${pc(st.avg)}</b></td>
        <td><b>${pc(st.mx[1])}</b><small>${dm(st.mx[0])}</small></td>
        <td><b>${pc(st.mn[1])}</b><small>${dm(st.mn[0])}</small></td>
        <td><b>${pc(st.now[1])}</b><small>${dm(st.now[0])}</small></td></tr>` : '';
      $('#trendFacts').innerHTML = `<p class="facts-head">${TT[trend.tenor]}・${ym(bs.first)} 至 ${ym(bs.now[0])}（每月數字）</p>
        <table class="facts-t"><thead><tr><th></th><th>期間平均</th><th>最高${nr ? '' : '<small>（嗰個月）</small>'}</th><th>最低${nr ? '' : '<small>（嗰個月）</small>'}</th><th>${nr ? '最近' : '最近一個月'}</th></tr></thead>
        <tbody>${row(bs, nr ? '牌價' : '銀行定期牌價', 'blue')}${row(hb, nr ? 'HIBOR<small>參考</small>' : 'HIBOR（只作參考）', 'grey')}</tbody></table>`;
      const span = trend.years ? `過去 ${trend.years} 年` : '1997 年以來';
      $('#trendNote').textContent = `${span}，${TT[trend.tenor]}港元定期牌價最高試過 ${pc(bs.mx[1])}（${ym(bs.mx[0])}），最低只有 ${pc(bs.mn[1])}（${ym(bs.mn[0])}），最近係 ${pc(bs.now[1])}。`
        + (hb ? `同期 HIBOR 喺 ${pc(hb.mn[1])} 至 ${pc(hb.mx[1])} 之間上落。` : '')
        + '息口會跟經濟環境大幅變動，高息唔會一直維持。';
    }
  }
  async function loadHkma() {
    for (const base of [REPO_DATA, LOCAL_DATA]) {
      try { const r = await fetch(base + 'hkma.json?t=' + Math.floor(Date.now() / 3600e3)); if (r.ok) { trend.hkma = await r.json(); break; } } catch {}
    }
    renderTrend();
  }

  // ---------- 資料來源 ----------
  function renderStatus() {
    if (!state.data) return;
    const label = { ok: '正常', stale: '暫時讀唔到，顯示舊數據', none: '暫時未能自動讀取' };
    const order = { ok: 0, stale: 1, none: 2 };
    $('#statusTable tbody').innerHTML = state.data.banks.slice().sort((a, b) => order[a.status] - order[b.status]).map((b) => `<tr>
      <td class="st-name"><b>${esc(b.name)}</b></td>
      <td data-l="狀態"><span class="dot ${b.status}"></span>${label[b.status] || b.status}</td>
      <td data-l="最後成功更新">${b.lastSuccess ? esc(timeAgo(b.lastSuccess)) : '—'}</td>
      <td data-l="來源網頁">${(b.sources || []).slice(0, 4).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">網頁${i + 1}</a>`).join('　') || `<a href="${esc(b.site)}" target="_blank" rel="noopener">官網</a>`}</td>
    </tr>`).join('');
  }

  // ---------- wiring ----------
  // amount boxes: tapping selects the whole number so typing replaces it; flag unlikely amounts
  function amountBox(el) {
    const sel = () => setTimeout(() => { try { el.setSelectionRange(0, el.value.length); } catch {} }, 0);
    el.addEventListener('focus', sel);
    el.addEventListener('click', () => { if (document.activeElement === el && el.selectionStart === el.selectionEnd && !el.dataset.typed) sel(); });
    el.addEventListener('input', () => { el.dataset.typed = '1'; });
    el.addEventListener('blur', () => { delete el.dataset.typed; });
  }
  function amountWarn(el, v) {
    const box = el.closest('.input');
    let w = box && box.parentElement.querySelector('.amt-warn');
    if (!w && box) { w = document.createElement('small'); w.className = 'amt-warn'; box.after(w); }
    if (w) w.textContent = v > 50000000 ? `你輸入咗 ${fmt(v)}，係咪多咗個零？` : '';
  }

  function setupTabs() {
    const tabs = document.querySelectorAll('.tabs button');
    const show = (name) => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
      if (location.hash !== '#' + name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
    };
    tabs.forEach((t) => t.addEventListener('click', () => { show(t.dataset.tab); window.scrollTo({ top: 0 }); }));
    document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.go); window.scrollTo({ top: 0 }); }));
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
    $('#amount').addEventListener('input', () => { state.amount = num($('#amount').value); save(); renderRates(); amountWarn($('#amount'), state.amount); });
    $('#amount').addEventListener('blur', () => { $('#amount').value = state.amount ? fmt(state.amount) : ''; });
    amountBox($('#amount'));
    amountBox($('#fxAmt'));
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

    setupTd();

    seg($('#tRange'), [{ v: 5, label: '5年' }, { v: 10, label: '10年' }, { v: 20, label: '20年' }, { v: 0, label: '全部' }], trend.years, (v) => { trend.years = v; renderTrend(); });
    seg($('#tTenor'), [1, 3, 6, 12].map((m) => ({ v: m, label: TT[m] })), trend.tenor, (v) => { trend.tenor = v; renderTrend(); });
    loadHkma();

    renderRates();
    load();
  }

  async function load() {
    const [data, hist] = await Promise.all([getJson('latest.json'), getJson('history.json'), loadLiveMid()]);
    state.allBanks = data.banks;
    data.banks = data.banks.filter((b) => b.deposits && b.deposits.length); // banks we could never read are left out
    state.data = data; state.history = hist;
    if (!data) {
      $('#updated').textContent = '暫時讀唔到數據';
      $('#cmp tbody').innerHTML = '<tr><td colspan="6" class="empty-msg">數據檔未準備好，系統第一次更新完成之後就會顯示。</td></tr>';
      return;
    }
    const ok = data.banks.filter((b) => b.status !== 'none').length;
    $('#updated').innerHTML = `更新於 <b>${esc(timeAgo(data.updatedAt))}</b><br>${ok} 間銀行`;
    if (state.banks) state.banks = state.banks.filter((id) => data.banks.some((b) => b.id === id));
    renderMe(); renderPicker(); renderRates(); renderFx(); renderTd(); renderTrend(); renderStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
