// Builds a one-line browser snippet (extract + parse) for manual testing in a real browser.
const fs = require('fs'); const { minify } = require('terser');
(async () => {
  const ex = fs.readFileSync(__dirname + '/../scraper/extract.js', 'utf8').replace(/if \(typeof module[\s\S]*$/, '');
  const pa = fs.readFileSync(__dirname + '/../scraper/parse.js', 'utf8').replace(/module\.exports[\s\S]*$/, '');
  const src = `window.__T=(function(){${ex}\n${pa}\nreturn {extractTables,parseDeposits,parseFx};})();`;
  const out = await minify(src, { compress: true, mangle: true });
  fs.writeFileSync(process.argv[2], out.code);
  console.log(out.code.length);
})();
