// Runs INSIDE the bank web page (via Playwright page.evaluate).
// Returns every <table> as a 2-D grid of cell text (colspan/rowspan expanded)
// plus the text that appears just before it (headings, tab labels) so we can
// work out which currency / product the table belongs to.
// Must stay self-contained: no imports, no outer variables.
function extractTables(doc) {
  doc = doc || document;
  const clean = (s) => (s || '').replace(/[ \s]+/g, ' ').trim();

  // cell text with a space between block elements ("<div>0.1</div><div>0.2</div>" -> "0.1 0.2"),
  // and spaced-out Chinese names joined back ("港 元" -> "港元")
  const BLOCK = /^(DIV|P|BR|LI|UL|OL|H[1-6]|SECTION|TABLE|TR|TD|TH|DL|DT|DD)$/;
  function cellText(node) {
    let out = '';
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) out += ch.nodeValue;
      else if (ch.nodeType === 1) { const b = BLOCK.test(ch.tagName); out += (b ? ' ' : '') + cellText(ch) + (b ? ' ' : ''); }
    });
    return out;
  }
  const joinCjk = (t) => (/^[\u4e00-\u9fff](?: [\u4e00-\u9fff])+$/.test(t) ? t.replace(/ /g, '') : t);

  function gridOf(table) {
    const grid = [];
    const rows = Array.from(table.rows || []);
    rows.forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      Array.from(tr.cells).forEach((cell) => {
        while (grid[r][c] !== undefined) c++;
        const text = joinCjk(clean(cellText(cell)));
        const cs = Math.min(parseInt(cell.colSpan, 10) || 1, 30);
        const rs = Math.min(parseInt(cell.rowSpan, 10) || 1, 60);
        for (let i = 0; i < rs; i++) {
          grid[r + i] = grid[r + i] || [];
          for (let j = 0; j < cs; j++) grid[r + i][c + j] = text;
        }
        c += cs;
      });
    });
    return grid.map((row) => Array.from(row || [], (v) => (v === undefined ? '' : v)));
  }

  // Text that precedes the table in document order (nearest last), max ~600 chars.
  function contextOf(table) {
    const parts = [];
    let total = 0;
    let node = table;
    let hops = 0;
    while (node && total < 600 && hops < 60) {
      let sib = node.previousElementSibling;
      while (sib && total < 600) {
        if (!/^(SCRIPT|STYLE|NOSCRIPT|TABLE)$/.test(sib.tagName)) {
          const t = clean(sib.textContent).slice(-300);
          if (t) { parts.unshift(t); total += t.length; }
        } else if (sib.tagName === 'TABLE') {
          // stop at previous table: its context is not ours
          total = 9999;
        }
        sib = sib.previousElementSibling;
        hops++;
      }
      node = node.parentElement;
      // tab panels: pick up the label of the tab that controls this panel
      if (node && node.getAttribute) {
        const lb = node.getAttribute('aria-labelledby');
        if (lb) {
          const el = doc.getElementById(lb.split(' ')[0]);
          if (el) parts.push('[TAB] ' + clean(el.textContent));
        }
        const al = node.getAttribute('aria-label') || node.getAttribute('data-title') || node.getAttribute('data-tab');
        if (al && al.length < 60) parts.push('[TAB] ' + clean(al));
      }
      hops++;
    }
    const cap = table.caption ? clean(table.caption.textContent) : '';
    if (cap) parts.push('[CAPTION] ' + cap);
    return parts.join(' | ').slice(-900);
  }

  const out = [];
  doc.querySelectorAll('table').forEach((t, i) => {
    if (t.getAttribute('data-scrape-skip')) return;
    const grid = gridOf(t);
    if (grid.length < 2) return;
    const flat = grid.flat().join(' ');
    if (!/\d/.test(flat)) return;
    out.push({ index: i, context: contextOf(t), grid });
  });
  return {
    title: clean(doc.title),
    url: (doc.defaultView || window).location.href,
    // page text is used for "effective date" detection and as a fallback
    text: clean(doc.body ? (doc.body.innerText || doc.body.textContent) : '').slice(0, 40000),
    // line-preserving text for the non-table fallback parser
    lines: (doc.body ? (doc.body.innerText || '') : '').slice(0, 60000),
    tables: out,
  };
}

if (typeof module !== 'undefined') module.exports = { extractTables };
