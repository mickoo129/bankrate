// List of banks. `seeds` are starting pages; the scraper follows links on them
// that look like deposit-rate / time-deposit / FX-rate pages (same site only).
// `pages` are pages known to contain rate tables (always scraped).
// type: 'promo' = 優惠/特惠 rates, 'board' = 牌價. If omitted it is guessed from page text.

module.exports = [
  // ---------- 大型銀行 ----------
  {
    id: 'hsbc', name: '滙豐', nameEn: 'HSBC', group: 'major',
    site: 'https://www.hsbc.com.hk',
    pages: [
      { url: 'https://www.hsbc.com.hk/zh-hk/accounts/offers/deposits/', type: 'promo' },
      { url: 'https://www.hsbc.com.hk/zh-hk/investments/market-information/hk/deposit-rate/', type: 'board' },
    ],
    fxPages: ['https://www.hsbc.com.hk/zh-hk/investments/currency-exchange-rate-calculator/'],
    seeds: ['https://www.hsbc.com.hk/zh-hk/accounts/products/time-deposits/'],
  },
  {
    id: 'hangseng', name: '恒生', nameEn: 'Hang Seng', group: 'major',
    site: 'https://www.hangseng.com',
    pages: [
      { url: 'https://cms.hangseng.com/cms/emkt/pmo/grp06/p04/chi/index.html', type: 'promo' },
      { url: 'https://cms.hangseng.com/cms/emkt/pmo/grp03/p97/chi/index.html', type: 'promo' },],
    seeds: [
      'https://www.hangseng.com/zh-hk/personal/banking/rates/deposit-interest-rates/',
      'https://www.hangseng.com/zh-hk/personal/banking/rates/foreign-exchange-rates/',
      'https://www.hangseng.com/zh-hk/personal/banking/time-deposits/',
      'https://www.hangseng.com/zh-hk/personal/banking/',
    ],
  },
  {
    id: 'bochk', name: '中銀香港', nameEn: 'BOCHK', group: 'major',
    site: 'https://www.bochk.com',
    pages: [],
    seeds: [
      'https://www.bochk.com/tc/deposits/promotion/timedeposits.html',
      'https://www.bochk.com/tc/deposits.html',
      'https://www.bochk.com/whk/rates/depositRates/depositRates-input.action?lang=hk',
      'https://www.bochk.com/whk/rates/exchangeRatesForCurrency/exchangeRatesForCurrency-input.action?lang=hk',
    ],
  },
  {
    id: 'sc', name: '渣打', nameEn: 'Standard Chartered', group: 'major',
    site: 'https://www.sc.com',
    exclude: 'sc\\.com/hk/(?!zh/)',
    pages: [
      { url: 'https://www.sc.com/hk/zh/deposits/online-time-deposit/', type: 'promo' },
      { url: 'https://www.sc.com/hk/zh/deposits/time-deposits-promotion/', type: 'promo' },
      { url: 'https://www.sc.com/hk/zh/deposits/foreign-exchange-time-deposit/', type: 'promo' },
      { url: 'https://www.sc.com/hk/zh/deposits/board-rates/', type: 'board' },
    ],
    seeds: ['https://www.sc.com/hk/zh/investment/foreign-exchange/'],
  },
  {
    id: 'bea', name: '東亞', nameEn: 'BEA', group: 'major',
    site: 'https://www.hkbea.com',
    pages: [
      { url: 'https://www.hkbea.com/html/tc/bea-personal-banking-supremegold-time-deposit.html', type: 'promo' },
      { url: 'https://www.hkbea.com/hk-form/?formId=RATE&rateType=hkddr&language=tc#/forms/MISC', type: 'board' },
      { url: 'https://www.hkbea.com/hk-form/?formId=RATE&rateType=fcdr&language=tc#/forms/MISC', type: 'board' },
    ],
    fxPages: ['https://www.hkbea.com/hk-form/?formId=RATE&rateType=ttfx&language=tc#/forms/MISC'],
    seeds: ['https://www.hkbea.com/', 'https://www.hkbea.com/html/tc/index.html'],
  },
  {
    id: 'citi', name: '花旗', nameEn: 'Citibank', group: 'major',
    site: 'https://www.citibank.com.hk',
    pages: [],
    seeds: ['https://www.citibank.com.hk/chinese/personal-banking/time-deposit/', 'https://www.citibank.com.hk/portal/home_chinese/hkcb_Home.htm'],
  },
  {
    id: 'dbs', name: '星展', nameEn: 'DBS', group: 'major',
    site: 'https://www.dbs.com.hk',
    pages: [],
    seeds: [
      'https://www.dbs.com.hk/personal-zh/deposits/time-deposits/default.page',
      'https://www.dbs.com.hk/personal-zh/rates-online/default.page',
      'https://www.dbs.com.hk/personal-zh/deposits/default.page',
    ],
  },
  // ---------- 中資 / 本地中型銀行 ----------
  {
    id: 'icbc', name: '工銀亞洲', nameEn: 'ICBC (Asia)', group: 'mid',
    site: 'https://www.icbcasia.com',
    pages: [],
    seeds: ['https://www.icbcasia.com/hk/tc/personal/default.html', 'https://www.icbcasia.com/hk/tc/default.html', 'https://www.icbcasia.com/hk/tc/'],
  },
  {
    id: 'ccb', name: '建行亞洲', nameEn: 'CCB (Asia)', group: 'mid',
    site: 'https://www.asia.ccb.com',
    pages: [],
    seeds: ['https://www.asia.ccb.com/hongkong_tc/personal/accounts/dep_rates.html', 'https://www.asia.ccb.com/hongkong_tc/personal/'],
  },
  {
    id: 'bocom', name: '交通銀行(香港)', nameEn: 'BOCOM (HK)', group: 'mid',
    site: 'https://www.hk.bankcomm.com',
    // offers are published in a file the system cannot read: send people to the bank's page
    promoUrl: 'https://www.hk.bankcomm.com/hk/hk/tw/file/getContentPath.html?fileId=2600167',
    pages: [
      // rate tables are drawn inside an iframe that only fills in when opened from these pages
      { url: 'https://www.hk.bankcomm.com/hk/shtml/hk/tw/2005155/2005178/2005179/list.shtml?channelId=2005155', type: 'board' },
      { url: 'https://www.hk.bankcomm.com/hk/shtml/hk/tw/2005155/2005178/2005180/list.shtml?channelId=2005155', type: 'board' },
      { url: 'https://www.hk.bankcomm.com/hk/tw/file/getContentPath.do?fileId=2600167', type: 'promo', pdf: true },],
    seeds: [],
  },
  {
    id: 'dahsing', name: '大新', nameEn: 'Dah Sing', group: 'mid',
    site: 'https://www.dahsing.com',
    pages: [],
    seeds: ['https://www.dahsing.com/html/tc/personal_banking/deposits.html', 'https://www.dahsing.com/html/tc/index.html'],
  },
  {
    id: 'citic', name: '中信銀行(國際)', nameEn: 'CNCBI', group: 'mid',
    site: 'https://www.cncbinternational.com',
    promoUrl: 'https://www.cncbinternational.com/personal/deposits/time-deposit/tc/index.jsp',
    pages: [
      { url: 'https://www.cncbinternational.com/rate-table/time_deposit_rate_tc.html', type: 'board', select: 'select' },
      { url: 'https://www.cncbinternational.com/personal/deposits/time-deposit/tc/index.jsp', type: 'promo' },],
    seeds: ['https://www.cncbinternational.com/personal/deposits/tc/index.jsp', 'https://www.cncbinternational.com/home/tc/index.jsp'],
  },
  {
    id: 'ocbc', name: '華僑銀行', nameEn: 'OCBC HK', group: 'mid',
    site: 'https://www.ocbc.com.hk',
    pages: [
      { url: 'https://www.ocbc.com.hk/personal-banking/deposits/foreign-currency-interest-rates', type: 'board' },
      // promo leaflet: every rate needs new funds placed at a branch
      { url: 'https://www.ocbc.com.hk/iwov-resources/hk/ocbc/personal/pdf/HKD.pdf', type: 'promo', pdf: true, conditions: ['新資金', '只限分行'] },],
    seeds: ['https://www.ocbc.com.hk/personal-banking/deposit-services/foreign-currency-deposit'],
  },
  {
    id: 'cmbwl', name: '招商永隆', nameEn: 'CMB Wing Lung', group: 'mid',
    site: 'https://www.cmbwinglungbank.com',
    pages: [
      { url: 'https://www.cmbwinglungbank.com/wlb_corporate/hk/personal/investments/financial-information/interest-rates/deposit-interest-rates.html', type: 'board' },],
    seeds: ['https://www.cmbwinglungbank.com/wlb_corporate/hk/personal/deposit.html', 'https://www.cmbwinglungbank.com/wlb_corporate/hk/index.html'],
  },
  {
    id: 'chonghing', name: '創興', nameEn: 'Chong Hing', group: 'mid',
    site: 'https://www.chbank.com',
    pages: [
      { url: 'https://www.chbank.com/tc/personal/banking-services/useful-information/deposit-rates/index.shtml', type: 'board' },],
    seeds: ['https://www.chbank.com/tc/personal/deposits/', 'https://www.chbank.com/tc/personal/index.shtml', 'https://www.chbank.com/'],
  },
  {
    id: 'fubon', name: '富邦', nameEn: 'Fubon', group: 'mid',
    site: 'https://www.fubonbank.com.hk',
    pages: [],
    seeds: ['https://www.fubonbank.com.hk/tc/deposit/fixed-deposit/home.html', 'https://www.fubonbank.com.hk/tc/rates-enquiry.html', 'https://www.fubonbank.com.hk/tc/home.html'],
  },
  {
    id: 'publicbank', name: '大眾銀行', nameEn: 'Public Bank', group: 'mid',
    site: 'https://www.publicbank.com.hk',
    pages: [],
    seeds: ['https://www.publicbank.com.hk/tc/personal/deposits', 'https://www.publicbank.com.hk/tc/'],
  },
  {
    id: 'shacom', name: '上海商業', nameEn: 'Shanghai Commercial', group: 'mid',
    site: 'https://www.shacombank.com.hk',
    pages: [],
    seeds: ['https://www.shacombank.com.hk/tch/personal/deposits/fixed/fixed.jsp', 'https://www.shacombank.com.hk/'],
  },
  {
    id: 'ncb', name: '南洋商業', nameEn: 'Nanyang Commercial', group: 'mid',
    site: 'https://www.ncb.com.hk',
    pages: [
      { url: 'https://www.ncb.com.hk/nanyang_bank/html/14ac.html', type: 'board', select: '#currency_select' },
      { url: 'https://www.ncb.com.hk/nanyang_bank/html/121023.html', type: 'promo' },],
    seeds: [],
  },
  {
    id: 'chiyu', name: '集友', nameEn: 'Chiyu', group: 'mid',
    site: 'https://www.chiyubank.com',
    pages: [
      { url: 'https://www.chiyubank.com/cyb/index/zxxx/20230523/index.shtml', type: 'promo', followPdf: '了解更多' },
      { url: 'https://www.chiyubank.com/wcs/trading-rate/', type: 'board' },],
    seeds: [],
  },
  // ---------- 虛擬銀行 ----------
  {
    id: 'za', name: 'ZA Bank', nameEn: 'ZA Bank', group: 'virtual',
    site: 'https://bank.za.group',
    pages: [
      { url: 'https://bank.za.group/hk/deposit', type: 'board', clicks: ['定期存款'] },],
    seeds: [],
  },
  {
    id: 'mox', name: 'Mox', nameEn: 'Mox', group: 'virtual',
    site: 'https://mox.com',
    pages: [],
    seeds: ['https://mox.com/zh/promotions/time-deposit/', 'https://mox.com/zh/'],
  },
  {
    id: 'welab', name: 'WeLab Bank', nameEn: 'WeLab Bank', group: 'virtual',
    site: 'https://www.welab.bank',
    pages: [
      { url: 'https://www.welab.bank/zh/feature/gosave_2/', type: 'promo', clicks: ['港元', '美元', '人民幣', '澳元', '英鎊', '日圓'] },],
    seeds: [],
  },
  {
    id: 'livi', name: 'livi', nameEn: 'livi bank', group: 'virtual',
    site: 'https://www.livibank.com',
    pages: [
      { url: 'https://www.livibank.com/zh_HK/features/livisave.html', type: 'promo' },],
    seeds: ['https://www.livibank.com/zh_HK/', 'https://www.livibank.com/zh_HK/features/'],
  },
  {
    id: 'fusion', name: '富融銀行', nameEn: 'Fusion Bank', group: 'virtual',
    site: 'https://www.fusionbank.com',
    pages: [],
    seeds: ['https://www.fusionbank.com/', 'https://www.fusionbank.com/deposit.html'],
  },
  {
    id: 'paob', name: '平安數字銀行', nameEn: 'Ping An Digital Bank', group: 'virtual',
    site: 'https://www.pingandb.com',
    pages: [
      { url: 'https://www.pingandb.com/tc/retail-savings.html', type: 'board' },],
    seeds: [],
  },
  {
    id: 'airstar', name: '大象銀行（前天星）', nameEn: 'EleBank (formerly Airstar)', group: 'virtual',
    site: 'https://www.elebank.com',
    pages: [
      { url: 'https://www.elebank.com/zh-hk/hkprime.html', type: 'board', clicks: ['港幣', '美元', '人民幣'] },],
    seeds: [],
  },
  {
    id: 'antbank', name: '螞蟻銀行', nameEn: 'Ant Bank', group: 'virtual',
    site: 'https://www.antbank.hk',
    pages: [],
    seeds: ['https://www.antbank.hk/', 'https://www.antbank.hk/zh-hk'],
  },
];
