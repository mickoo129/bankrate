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
    pages: [],
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
    pages: [],
    seeds: ['https://www.hk.bankcomm.com/hk/shtml/hk/cn/', 'https://www.hk.bankcomm.com/'],
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
    pages: [],
    seeds: ['https://www.cncbinternational.com/personal/deposits/tc/index.jsp', 'https://www.cncbinternational.com/home/tc/index.jsp'],
  },
  {
    id: 'ocbc', name: '華僑銀行', nameEn: 'OCBC HK', group: 'mid',
    site: 'https://www.ocbc.com.hk',
    pages: [],
    seeds: ['https://www.ocbc.com.hk/', 'https://www.ocbc.com.hk/personal-banking/zh-hk/'],
  },
  {
    id: 'cmbwl', name: '招商永隆', nameEn: 'CMB Wing Lung', group: 'mid',
    site: 'https://www.cmbwinglungbank.com',
    pages: [],
    seeds: ['https://www.cmbwinglungbank.com/wlb_corporate/hk/personal/deposit.html', 'https://www.cmbwinglungbank.com/wlb_corporate/hk/index.html'],
  },
  {
    id: 'chonghing', name: '創興', nameEn: 'Chong Hing', group: 'mid',
    site: 'https://www.chbank.com',
    pages: [],
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
    pages: [],
    seeds: ['https://www.ncb.com.hk/nanyang_bank/personal_banking/deposit_services/', 'https://www.ncb.com.hk/'],
  },
  {
    id: 'chiyu', name: '集友', nameEn: 'Chiyu', group: 'mid',
    site: 'https://www.chiyubank.com',
    pages: [],
    seeds: ['https://www.chiyubank.com/tc/deposits.html', 'https://www.chiyubank.com/tc/home.html'],
  },
  // ---------- 虛擬銀行 ----------
  {
    id: 'za', name: 'ZA Bank', nameEn: 'ZA Bank', group: 'virtual',
    site: 'https://bank.za.group',
    pages: [],
    seeds: ['https://bank.za.group/hk/deposit', 'https://bank.za.group/hk/'],
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
    pages: [],
    seeds: ['https://www.welab.bank/zh/', 'https://www.welab.bank/zh/feature/'],
  },
  {
    id: 'livi', name: 'livi', nameEn: 'livi bank', group: 'virtual',
    site: 'https://www.livibank.com',
    pages: [],
    seeds: ['https://www.livibank.com/zh_HK/', 'https://www.livibank.com/zh_HK/features/'],
  },
  {
    id: 'fusion', name: '富融銀行', nameEn: 'Fusion Bank', group: 'virtual',
    site: 'https://www.fusionbank.com',
    pages: [],
    seeds: ['https://www.fusionbank.com/', 'https://www.fusionbank.com/deposit.html'],
  },
  {
    id: 'paob', name: '平安壹賬通', nameEn: 'PAOB', group: 'virtual',
    site: 'https://www.paob.com.hk',
    pages: [],
    seeds: ['https://www.paob.com.hk/tc/', 'https://www.paob.com.hk/'],
  },
  {
    id: 'airstar', name: '天星銀行', nameEn: 'Airstar Bank', group: 'virtual',
    site: 'https://www.airstarbank.com',
    pages: [],
    seeds: ['https://www.airstarbank.com/zh-hk/', 'https://www.airstarbank.com/zh-hk/deposit.html'],
  },
  {
    id: 'antbank', name: '螞蟻銀行', nameEn: 'Ant Bank', group: 'virtual',
    site: 'https://www.antbank.hk',
    pages: [],
    seeds: ['https://www.antbank.hk/', 'https://www.antbank.hk/zh-hk'],
  },
];
