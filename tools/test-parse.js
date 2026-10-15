// Quick checks for the table parser using shapes seen on real bank pages.
const assert = require('assert');
const { parseDeposits, parseFx, parseTenor, parseRate, validUntil } = require('../scraper/parse');

// tenors
assert.strictEqual(parseTenor('7日'), 7);
assert.strictEqual(parseTenor('一星期'), 7);
assert.strictEqual(parseTenor('3個月'), 90);
assert.strictEqual(parseTenor('12 Months'), 360);
assert.strictEqual(parseTenor('1年'), 360);
assert.strictEqual(parseTenor('港元10,000 至 港元29,999'), null);
assert.strictEqual(parseRate('3.30%'), 3.3);
assert.strictEqual(parseRate('3.30% p.a.'), 3.3);
assert.strictEqual(parseRate('不適用'), null);
assert.strictEqual(validUntil('由即日起至2026年10月31日'), '2026-10-31');

// board-rate table: tenors in rows, amount tiers in columns, currency in heading (渣打 style)
let rows = parseDeposits({ tables: [{ index: 0, context: '美元存款利率 | 定期存款年利率', grid: [
  ['存款期', '美元2,000 至 美元49,999', '美元50,000 至 美元499,999'],
  ['7日', '0.50%', '0.50%'],
  ['12個月', '0.60%', '0.65%'],
] }] }, { type: 'board', url: 'x' });
assert.strictEqual(rows.length, 4);
assert.ok(rows.every((r) => r.currency === 'USD'));
assert.strictEqual(rows.find((r) => r.tenorDays === 360 && r.minAmount === 50000).rate, 0.65);

// promo table: currencies as columns, tenors as rows
rows = parseDeposits({ tables: [{ index: 0, context: '新資金定期存款優惠', grid: [
  ['存款期', '港元', '美元', '人民幣', '加元'],
  ['3個月', '2.40%', '3.30%', '1.00%', '3.00%'],
  ['6個月', '2.40%', '3.40%', '1.10%', '3.00%'],
] }] }, { type: 'promo', url: 'x' });
assert.deepStrictEqual([...new Set(rows.map((r) => r.currency))].sort(), ['CNY', 'HKD', 'USD']);
assert.ok(rows[0].conditions.includes('新資金'));

// transposed: tenors across the header row
rows = parseDeposits({ tables: [{ index: 0, context: '澳元定期存款', grid: [
  ['', '1個月', '3個月', '6個月'],
  ['AUD 10,000+', '3.1%', '3.2%', '3.3%'],
] }] }, { type: 'promo', url: 'x' });
assert.strictEqual(rows.length, 3);
assert.ok(rows.every((r) => r.currency === 'AUD'));

// other currency table must be ignored
rows = parseDeposits({ tables: [{ index: 0, context: '澳元 | 加拿大元 | [CAPTION] 定期存款', grid: [
  ['存款期', '2,000加拿大元 至 99,999加拿大元'], ['一星期', '0.15%'],
] }] }, { type: 'board', url: 'x' });
assert.strictEqual(rows.length, 0);

// FX table (TT buy / sell, JPY quoted per 100)
const fx = parseFx({ tables: [{ index: 0, context: '', grid: [
  ['貨幣', '電匯買入', '電匯賣出', '現鈔買入', '現鈔賣出'],
  ['美元 USD', '7.8100', '7.8700', '7.7500', '7.9000'],
  ['日圓 JPY', '4.9200', '5.0300', '4.8000', '5.1000'],
  ['加元 CAD', '5.6', '5.8', '5.5', '5.9'],
] }] }, { USD: 7.8487, JPY: 0.049581 });
assert.ok(Math.abs(fx.USD.buy - 7.81) < 1e-9 && fx.USD.tt);
assert.ok(Math.abs(fx.JPY.sell - 0.0503) < 1e-9);
assert.ok(!fx.CAD);

console.log('all parser tests passed');
