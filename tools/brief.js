const fs = require('fs');
const { parseDeposits } = require('../scraper/parse');
for (const id of process.argv.slice(2)) {
  const pages = JSON.parse(fs.readFileSync(`debug/${id}.json`, 'utf8'));
  console.log(`\n===== ${id}`);
  for (const p of pages) for (const t of p.tables) {
    const rows = parseDeposits({ tables: [{ index: t.i, context: t.ctx, grid: t.grid }] }, { type: p.type === 'auto' ? 'auto' : p.type, url: p.url }).filter((r) => ['HKD', 'USD'].includes(r.currency) && r.tenorDays >= 7);
    if (!rows.length) continue;
    const by = {};
    for (const r of rows) { const k = r.currency + r.tenor; by[k] = Math.max(by[k] || 0, r.rate); }
    console.log(`[${p.type}] ${p.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 55)} #${t.i}\n   ctx…${t.ctx.slice(-110).replace(/\s+/g, ' ')}\n   head: ${t.grid[0].slice(0, 6).join(' / ').slice(0, 110)}\n   => ${Object.entries(by).map(([k, v]) => k + '=' + v).join(' ')} ${rows[0].segment ? '{seg:' + rows[0].segment + '}' : ''} ${rows[0].conditions.join(',')}`);
  }
}
