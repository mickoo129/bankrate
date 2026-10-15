const fs = require('fs');
const { parseDeposits } = require('../scraper/parse');
const [id, ccy = 'HKD', maxDays = '400'] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(`debug/${id}.json`, 'utf8'));
for (const p of pages) for (const r of parseDeposits({ tables: p.tables.map((t) => ({ index: t.i, context: t.ctx, grid: t.grid })), text: p.text || p.tables.map((t) => t.ctx).join(' ') }, { type: p.type, url: p.url }))
  if (r.currency === ccy && r.tenorDays >= 7 && r.tenorDays <= +maxDays) console.log(r.tenor.padEnd(5), String(r.rate).padEnd(6), r.type.padEnd(5), 'min=' + r.minAmount, JSON.stringify(r.conditions), 'seg=' + r.segment, '| ' + (r.tierLabel || '').slice(0, 40), '#' + r.tableIndex, p.url.slice(-40));
