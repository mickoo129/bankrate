// Re-run the parser over saved debug tables (no network) and print best rate per tenor
const fs = require('fs');
const { parseDeposits } = require('../scraper/parse');
const T = [7, 30, 90, 180, 360];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync('debug').map((f) => f.replace('.json', ''));
for (const id of ids) {
  const pages = JSON.parse(fs.readFileSync(`debug/${id}.json`, 'utf8'));
  let rows = [];
  for (const p of pages) rows.push(...parseDeposits({ tables: p.tables.map((t) => ({ index: t.i, context: t.ctx, grid: t.grid })), text: p.text || p.tables.map((t) => t.ctx).join(' ') }, { type: p.type, url: p.url }));
  rows = rows.filter((r) => r.tenorDays >= 7);
  if (!rows.length) continue;
  for (const c of ['HKD', 'USD']) {
    const cell = (t, f) => { const rs = rows.filter((r) => r.currency === c && r.tenorDays === t && f(r)).sort((a, b) => b.rate - a.rate); return rs[0]; };
    const fmt = (r) => (r ? r.rate + (r.type === 'promo' ? '*' : '') : '-');
    // "everyone": new customer, new funds, not premium, no FX conversion
    const PREM = /卓越|尊尚|優越|豐盛|Citigold|優先理財|財富|VIP|私人|貴賓|顯卓|至尊|高級理財|Premier|Prestige/i;
    const plain = (r) => !r.conditions.includes('需經本行兌換') && !PREM.test(r.conditions.join(' ') + r.segment + r.tierLabel);
    console.log(id.padEnd(10), c, 'all:', T.map((t) => fmt(cell(t, () => true)).padEnd(7)).join(' '), '| regular:', T.map((t) => fmt(cell(t, plain)).padEnd(7)).join(' '));
  }
}
