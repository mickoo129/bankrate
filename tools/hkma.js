// Downloads long-run Hong Kong interest rate history from the HKMA open API (monthly figures)
// and writes public/data/hkma.json. Runs from GitHub Actions; skips if refreshed within 7 days.
//   - dr_*  : average HKD time deposit rates quoted by major banks (deposits < HK$100,000)
//   - ir_*  : HIBOR fixing, end of month — shown only as a reference line, NOT a deposit rate
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'data', 'hkma.json');
const BASE = 'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function all(endpoint, extra = '') {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    let j = null;
    for (let tries = 0; tries < 3 && !j; tries++) {
      try {
        const r = await fetch(`${BASE}${endpoint}?pagesize=1000&offset=${offset}${extra}`, { headers: { 'User-Agent': 'hk-deposit-rates (github actions)' } });
        if (r.ok) j = await r.json();
      } catch {}
      if (!j) await wait(5000);
    }
    if (!j || !j.result) throw new Error('HKMA API failed: ' + endpoint);
    rows.push(...j.result.records);
    if (j.result.records.length < 1000) break;
    await wait(1500);
  }
  return rows;
}

(async () => {
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (Date.now() - Date.parse(old.updatedAt) < 7 * 864e5 && !process.argv.includes('--force')) { console.log('hkma.json is fresh'); return; }
  } catch {}
  const dep = await all('hkd-ir-periodaverage');
  await wait(2000);
  const hib = await all('hk-interbank-ir-endperiod', '&segment=hibor.fixing');
  const byMonth = {};
  for (const r of dep) byMonth[r.end_of_month] = { ...(byMonth[r.end_of_month] || {}), d1: r.dr_1m, d3: r.dr_3m, d6: r.dr_6m, d12: r.dr_12m, sv: r.savings_deposit_rate };
  for (const r of hib) byMonth[r.end_of_month] = { ...(byMonth[r.end_of_month] || {}), h1: r.ir_1m, h3: r.ir_3m, h6: r.ir_6m, h12: r.ir_12m };
  const months = Object.keys(byMonth).filter((m) => m >= '1997-01').sort();
  const out = { updatedAt: new Date().toISOString(), source: 'HKMA Open API', months: months.map((m) => [m, byMonth[m]]) };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`hkma.json: ${months.length} months, ${months[0]} – ${months[months.length - 1]}`);
})().catch((e) => { console.error(e.message); process.exitCode = 0; });
