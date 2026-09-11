// The character framebuffer. Everything the instrument shows is written into
// this grid; flush() diffs it against the previous frame and patches only
// the rows that changed into a stack of <div> rows (kept as real, selectable
// text — the whole point of an ASCII instrument is that the screen IS the data).

export class Screen {
  constructor(cols, rows, el) {
    this.cols = cols;
    this.rows = rows;
    this.el = el;
    this.buf = [];
    this.prev = [];
    for (let y = 0; y < rows; y++) {
      this.buf.push(this._blankRow());
      this.prev.push(null);
    }
    this.rowEls = [];
    for (let y = 0; y < rows; y++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      el.appendChild(rowEl);
      this.rowEls.push(rowEl);
    }
  }

  _blankRow() {
    const row = new Array(this.cols);
    for (let x = 0; x < this.cols; x++) row[x] = { ch: ' ', cls: '' };
    return row;
  }

  clear() {
    for (let y = 0; y < this.rows; y++) {
      const row = this.buf[y];
      for (let x = 0; x < this.cols; x++) { row[x].ch = ' '; row[x].cls = ''; }
    }
  }

  put(x, y, ch, cls = '') {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    if (!ch) return;
    const cell = this.buf[y][x];
    cell.ch = ch[0];
    cell.cls = cls;
  }

  text(x, y, str, cls = '') {
    if (y < 0 || y >= this.rows || !str) return;
    for (let i = 0; i < str.length; i++) {
      const cx = x + i;
      if (cx < 0) continue;
      if (cx >= this.cols) break;
      this.put(cx, y, str[i], cls);
    }
  }

  hline(x, y, w, ch = '─', cls = '') {
    for (let i = 0; i < w; i++) this.put(x + i, y, ch, cls);
  }

  vline(x, y, h, ch = '│', cls = '') {
    for (let i = 0; i < h; i++) this.put(x, y + i, ch, cls);
  }

  // Fills a rectangle with a character (default: blank it).
  rect(x, y, w, h, ch = ' ', cls = '') {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, ch, cls);
  }

  flush() {
    for (let y = 0; y < this.rows; y++) {
      const row = this.buf[y];
      const prevRow = this.prev[y];
      if (prevRow && rowsEqual(row, prevRow)) continue;
      this.rowEls[y].innerHTML = renderRow(row);
      this.prev[y] = row.map((c) => ({ ch: c.ch, cls: c.cls }));
    }
  }
}

function rowsEqual(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i].ch !== b[i].ch || a[i].cls !== b[i].cls) return false;
  }
  return true;
}

function renderRow(row) {
  let html = '';
  let runCls = null;
  let runStr = '';
  const flush = () => {
    if (!runStr) return;
    const esc = escapeHtml(runStr);
    html += runCls ? `<span class="${runCls}">${esc}</span>` : esc;
    runStr = '';
  };
  for (const cell of row) {
    if (cell.cls !== runCls) { flush(); runCls = cell.cls; }
    runStr += cell.ch;
  }
  flush();
  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
