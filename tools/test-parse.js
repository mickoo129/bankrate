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

// --- cases found when checking against bank websites (Oct 2026) ---
// savings offer laid out like a deposit table (建行)
rows = parseDeposits({ tables: [{ index: 0, context: '「月月增息儲蓄戶口」優惠 於推廣期內客戶只需成功開立戶口，可享以下活期儲蓄存款年利率：', grid: [
  ['存款貨幣', '存款期', '特惠定期存款年利率'], ['港元', '3個月', '高達 3.60%'], ['美元', '3個月', '高達 5.50%'],
] }] }, { type: 'promo', url: 'x' });
assert.strictEqual(rows.length, 0, 'savings table must be ignored');
// USD table whose caption also mentions 港幣 (滙豐獎賞錢)
rows = parseDeposits({ tables: [{ index: 0, context: '其他客戶 | [CAPTION] 最低存款金額：2,000美元或以上 等值年利率根據…每1「獎賞錢」可抵銷價值港幣1元', grid: [
  ['存款期', '等值年利率'], ['3個月', '3.10%'],
] }] }, { type: 'promo', url: 'x' });
assert.strictEqual(rows[0].currency, 'USD');
// "USD2,000 to USD49,999" header
rows = parseDeposits({ tables: [{ index: 0, context: 'Time deposit', grid: [['Tenor', 'USD2,000 to USD49,999'], ['7 Days', '0.50%']] }] }, { type: 'board', url: 'x' });
assert.strictEqual(rows[0].currency, 'USD');
// tier written as a row label after a transposed table (大新): VIP must be tagged
rows = parseDeposits({ tables: [{ index: 0, context: '港元定期存款優惠 以全新資金開立', grid: [
  ['VIP 銀行服務客戶', 'VIP 銀行服務客戶', 'VIP 銀行服務客戶'], ['存款金額（港元）', '存款期', '存款期'], ['存款金額（港元）', '1個月', '3個月'], ['200,000 - 1,000,000以下', '0.001%', '3%'],
] }] }, { type: 'promo', url: 'x' });
assert.ok(rows.length === 1 && rows[0].rate === 3 && rows[0].conditions.includes('高級理財客戶'), 'VIP row tagged, 0.001% dropped');
// "3/6個月"
rows = parseDeposits({ tables: [{ index: 0, context: '網上專屬定期存款優惠利率', grid: [['貨幣', '存款期', '特優年利率 (%)'], ['港元', '3/6個月', '2.40']] }] }, { type: 'promo', url: 'x' });
assert.deepStrictEqual(rows.map((r) => r.tenorDays).sort(), [180, 90].sort());
// "不論新舊資金" is not a new-funds offer
rows = parseDeposits({ tables: [{ index: 0, context: '特優港元定期存款優惠 (不論新舊資金)', grid: [['存款期', '港元'], ['3個月', '3.00%']] }] }, { type: 'promo', url: 'x' });
assert.ok(!rows[0].conditions.includes('新資金'));

rows = parseDeposits({ tables: [{ index: 0, context: '定期存款優惠 查看更多 | 特優(外幣兌換)定期存款優惠', grid: [['貨幣', '存期', '年利率'], ['HKD', '7天', '6.00%']] }] }, { type: 'promo', url: 'x' });
assert.ok(rows[0].conditions.includes('需經本行兌換'));
// minimum deposit written as a sentence
const { contextMins } = require('../scraper/parse');
assert.deepStrictEqual(contextMins('最低存款金額：港幣10,000元或以上 等值年利率根據…以每1「獎賞錢」可抵銷價值港幣1元'), { HKD: 10000 });
assert.deepStrictEqual(contextMins('最低存款金額：港元10,000/人民幣10,000/其他外幣2,000原幣'), { HKD: 10000, CNY: 10000, FOREIGN: 2000 });
assert.deepStrictEqual(contextMins('(原幣2,000或以上 /港元10,000或以上)', { loose: true }), { FOREIGN: 2000, HKD: 10000 });
assert.deepStrictEqual(contextMins('金額少於HKD100,000以下'), {});
rows = parseDeposits({ tables: [{ index: 0, context: '港元新資金定期存款優惠 | [CAPTION] 最低存款金額：港幣10,000元或以上', grid: [['存款期', '定期存款年利率'], ['3個月', '2.40%']] }] }, { type: 'promo', url: 'x' });
assert.strictEqual(rows[0].minAmount, 10000);
// header listing several currencies' minimums (富邦)
rows = parseDeposits({ tables: [{ index: 0, context: '新資金定期存款優惠', grid: [
  ['存款金額', '港元 1,000,000 / 美元128,000 / 澳元100,000 (或以上)', '港元 1,000,000 / 美元128,000 / 澳元100,000 (或以上)'], ['存款期', '三個月', '六個月'], ['港元', '3.2%', '3.4%'], ['美元', '4.45%', '/'],
] }] }, { type: 'promo', url: 'x' });
assert.strictEqual(rows.find((r) => r.currency === 'USD').minAmount, 128000);
assert.strictEqual(rows.find((r) => r.currency === 'HKD').minAmount, 1000000);
console.log('all parser tests passed');


{ // ICBC new-customer page: cap, nearest promo period
  const { capAmounts, validUntilNear, contextMins } = require('../scraper/parse');
  const t = '港幣3個月特惠定存年利率6% 推廣期：2026年10月2日至2026年12月31日（包括首尾兩天） 經手機銀行「e定存」功能開立3個月港元定期存款起存金額為HK$1,000，累計存款金額最高為HK$200,000； 信用卡迎新賞 推廣期：2026年4月1日至2027年3月31日';
  const assert = require('assert');
  assert.strictEqual(capAmounts(t).HKD, 200000);
  assert.strictEqual(validUntilNear(t, 0), '2026-12-31');
  assert.strictEqual(contextMins(t, { strict: true }).HKD, 1000);
  console.log('icbc cap test ok');
}

{ // glued branch/app rates, page-level 年利率, untracked-currency title, savings-plan title
  const assert = require('assert');
  const { parseRate, parseDeposits } = require('../scraper/parse');
  assert.strictEqual(parseRate('0.001000.00100', true), 0.001);
  assert.strictEqual(parseRate('0.25000 0.30000', true), 0.25);
  const page = (grid, ctx = '') => parseDeposits({ tables: [{ index: 0, context: ctx, grid }], text: '單位: 年利率' }, { type: 'board', url: 'x' });
  assert.ok(page([['貨幣', '最低存款額 (人民幣)', '存款期', '存款期'], ['貨幣', '最低存款額 (人民幣)', '1 個月', '3 個月'], ['人民幣', '10,000', '0.4500', '0.5000']]).some((r) => r.currency === 'CNY' && r.rate === 0.5));
  assert.strictEqual(page([['紐西蘭元定期存款利率', '紐西蘭元定期存款利率'], ['存款期', '年利率'], ['1 個月', '0.20%'], ['3 個月', '0.30%']], '美元').length, 0);
  assert.strictEqual(page([['萬利錢儲蓄存款', '更新時間'], ['存款期', '年利率〈%〉'], ['12 個月', '1.00000'], ['18 個月', '1.00000']], '港元').length, 0);
  console.log('format tests ok');
}
