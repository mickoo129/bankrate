// node tools/show.js <bank> [filterRegex]  — prints tables the scraper read, with the rows it produced
const fs = require('fs');
const { parseDeposits } = require('../scraper/parse');
const [id, re] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(`debug/${id}.json`, 'utf8'));
for (const p of pages) {
  for (const t of p.tables) {
    const rows = parseDeposits({ tables: [{ index: t.i, context: t.ctx, grid: t.grid }] }, { type: p.type === 'auto' ? 'promo' : p.type, url: p.url })
      .filter((r) => ['HKD', 'USD'].includes(r.currency));
    if (!rows.length) continue;
    if (re && !new RegExp(re).test(t.ctx + JSON.stringify(t.grid))) continue;
    console.log(`\n### ${p.url.slice(0, 90)} [${p.type}] table ${t.i}`);
    console.log('CTX:', t.ctx.slice(-200));
    for (const r of t.grid.slice(0, 12)) console.log('  | ' + r.slice(0, 8).map((c) => c.slice(0, 22)).join(' | '));
    console.log('  => ' + rows.slice(0, 10).map((r) => `${r.currency} ${r.tenor} ${r.rate}`).join(', '));
  }
}
