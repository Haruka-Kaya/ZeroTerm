// ZeroTerm terminal core: VT/ANSI emulator and DOM renderer.
// Shared by the real web client and the mock UI preview.

const decoder = new TextDecoder("utf-8");

export const SCROLLBACK_LIMIT = 5000;

const ANSI_COLORS = [
  "#1d2127",
  "#e06c75",
  "#98c379",
  "#e5c07b",
  "#61afef",
  "#c678dd",
  "#56b6c2",
  "#d7dae0",
];
const ANSI_BRIGHT = [
  "#5c6370",
  "#ff7a85",
  "#a8e59f",
  "#f7d794",
  "#82aaff",
  "#d8a6ff",
  "#7ee0d6",
  "#ffffff",
];
const DEFAULT_FG = "var(--term-fg)";
const DEFAULT_BG = "var(--term-bg)";

const escapeHtml = (text) =>
  text.replace(/[&<>]/g, (char) => {
    if (char === "&") {
      return "&amp;";
    }
    if (char === "<") {
      return "&lt;";
    }
    return "&gt;";
  });

const colorFrom256 = (value) => {
  if (value < 0 || value > 255 || Number.isNaN(value)) {
    return null;
  }
  if (value < 16) {
    return (ANSI_COLORS.concat(ANSI_BRIGHT))[value];
  }
  if (value >= 232) {
    const shade = 8 + (value - 232) * 10;
    return `rgb(${shade}, ${shade}, ${shade})`;
  }
  const index = value - 16;
  const r = Math.floor(index / 36);
  const g = Math.floor((index % 36) / 6);
  const b = index % 6;
  const map = [0, 95, 135, 175, 215, 255];
  return `rgb(${map[r]}, ${map[g]}, ${map[b]})`;
};

export class TerminalEmulator {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.screen = this._createScreen(rows, cols);
    this.altScreen = this._createScreen(rows, cols);
    this.useAlt = false;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.cursorVisible = true;
    this.savedCursor = { row: 0, col: 0 };
    this.mainCursor = { row: 0, col: 0 };
    this.altCursor = { row: 0, col: 0 };
    this.fg = null;
    this.bg = null;
    this.bold = false;
    this.inverse = false;
    this.state = "normal";
    this.csiBuffer = "";
    this.oscBuffer = "";
    this.decoder = decoder;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.dirtyRows = new Set();
    this.dirtyAll = true;
    // Lines that have scrolled off the top of the main screen, oldest first.
    this.scrollback = [];
    this.scrollbackLimit = SCROLLBACK_LIMIT;
    // Number of lines appended to scrollback since the renderer last drained it.
    this.scrollbackPending = 0;
  }

  /** Render one scrollback line to HTML, or "" when the index is stale. */
  renderScrollbackLine(index) {
    const line = this.scrollback[index];
    return line ? this._renderLine(line) : "";
  }

  /** Hand the renderer the lines pushed to scrollback since the last call. */
  consumeScrollback() {
    const pending = this.scrollbackPending;
    this.scrollbackPending = 0;
    if (pending <= 0) {
      return [];
    }
    return this.scrollback.slice(Math.max(0, this.scrollback.length - pending));
  }

  clearScrollback() {
    this.scrollback.length = 0;
    this.scrollbackPending = 0;
  }

  _pushScrollback(line) {
    this.scrollback.push(line);
    this.scrollbackPending += 1;
    const overflow = this.scrollback.length - this.scrollbackLimit;
    if (overflow > 0) {
      this.scrollback.splice(0, overflow);
    }
  }

  resize(rows, cols) {
    if (rows <= 0 || cols <= 0) {
      return;
    }
    if (rows === this.rows && cols === this.cols) {
      return;
    }
    this.screen = this._resizeScreen(this.screen, rows, cols);
    this.altScreen = this._resizeScreen(this.altScreen, rows, cols);
    this.rows = rows;
    this.cols = cols;
    this.cursorRow = Math.min(this.cursorRow, rows - 1);
    this.cursorCol = Math.min(this.cursorCol, cols - 1);
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this._markAllDirty();
  }

  write(bytes) {
    const text = this.decoder.decode(bytes, { stream: true });
    for (const ch of text) {
      this._processChar(ch);
    }
  }

  renderText() {
    const screen = this._activeScreen();
    return screen.map((line) => this._renderLine(line)).join("\n");
  }

  /** Plain (unstyled) text of one live row, trailing blanks trimmed. */
  renderRowText(row) {
    const screen = this._activeScreen();
    const line = screen[row];
    if (!line) {
      return "";
    }
    return line.map((cell) => cell.ch).join("").replace(/\s+$/, "");
  }

  renderRow(row) {
    const screen = this._activeScreen();
    if (row < 0 || row >= screen.length) {
      return "";
    }
    return this._renderLine(screen[row]);
  }

  consumeDirtyRows() {
    if (this.dirtyAll) {
      this.dirtyAll = false;
      this.dirtyRows.clear();
      return { all: true, rows: [] };
    }
    if (this.dirtyRows.size === 0) {
      return null;
    }
    const rows = Array.from(this.dirtyRows);
    this.dirtyRows.clear();
    return { all: false, rows };
  }

  _processChar(ch) {
    if (this.state === "normal") {
      if (ch === "\x1b") {
        this.state = "esc";
        return;
      }
      if (ch === "\n") {
        this._lineFeed();
        return;
      }
      if (ch === "\r") {
        this.cursorCol = 0;
        return;
      }
      if (ch === "\b") {
        if (this.cursorCol > 0) {
          this.cursorCol -= 1;
        }
        return;
      }
      if (ch === "\t") {
        this._tab();
        return;
      }
      if (ch === "\x07") {
        return;
      }
      this._writeChar(ch);
      return;
    }

    if (this.state === "esc") {
      if (ch === "[") {
        this.state = "csi";
        this.csiBuffer = "";
        return;
      }
      if (ch === "]") {
        this.state = "osc";
        this.oscBuffer = "";
        return;
      }
      if (ch === "7") {
        this.savedCursor = { row: this.cursorRow, col: this.cursorCol };
        this.state = "normal";
        return;
      }
      if (ch === "8") {
        this.cursorRow = this.savedCursor.row;
        this.cursorCol = this.savedCursor.col;
        this.state = "normal";
        return;
      }
      if (ch === "D") {
        this._lineFeed();
        this.state = "normal";
        return;
      }
      if (ch === "M") {
        this._reverseIndex();
        this.state = "normal";
        return;
      }
      if (ch === "c") {
        this._reset();
        this.state = "normal";
        return;
      }
      this.state = "normal";
      return;
    }

    if (this.state === "csi") {
      if (ch >= "@" && ch <= "~") {
        this._handleCsi(ch, this.csiBuffer);
        this.state = "normal";
        return;
      }
      this.csiBuffer += ch;
      return;
    }

    if (this.state === "osc") {
      if (ch === "\x07") {
        this.state = "normal";
        return;
      }
      if (ch === "\x1b") {
        this.state = "osc_esc";
        return;
      }
      this.oscBuffer += ch;
      return;
    }

    if (this.state === "osc_esc") {
      if (ch === "\\") {
        this.state = "normal";
        return;
      }
      this.state = "osc";
    }
  }

  _handleCsi(finalChar, buffer) {
    let prefix = "";
    let params = buffer;
    if (params.startsWith("?")) {
      prefix = "?";
      params = params.slice(1);
    }
    const parts = params.length ? params.split(";") : [];
    const toInt = (value, fallback) => {
      const num = parseInt(value, 10);
      if (Number.isNaN(num) || num === 0) {
        return fallback;
      }
      return num;
    };
    const toIntAllowZero = (value, fallback) => {
      const num = parseInt(value, 10);
      if (Number.isNaN(num)) {
        return fallback;
      }
      return num;
    };

    switch (finalChar) {
      case "A": {
        const count = toInt(parts[0], 1);
        this.cursorRow = Math.max(0, this.cursorRow - count);
        break;
      }
      case "B": {
        const count = toInt(parts[0], 1);
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + count);
        break;
      }
      case "C": {
        const count = toInt(parts[0], 1);
        this.cursorCol = Math.min(this.cols - 1, this.cursorCol + count);
        break;
      }
      case "D": {
        const count = toInt(parts[0], 1);
        this.cursorCol = Math.max(0, this.cursorCol - count);
        break;
      }
      case "E": {
        const count = toInt(parts[0], 1);
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + count);
        this.cursorCol = 0;
        break;
      }
      case "F": {
        const count = toInt(parts[0], 1);
        this.cursorRow = Math.max(0, this.cursorRow - count);
        this.cursorCol = 0;
        break;
      }
      case "G": {
        const col = toInt(parts[0], 1) - 1;
        this.cursorCol = Math.max(0, Math.min(this.cols - 1, col));
        break;
      }
      case "d": {
        const row = toInt(parts[0], 1) - 1;
        this.cursorRow = Math.max(0, Math.min(this.rows - 1, row));
        break;
      }
      case "H":
      case "f": {
        const row = toInt(parts[0], 1) - 1;
        const col = toInt(parts[1], 1) - 1;
        this.cursorRow = Math.max(0, Math.min(this.rows - 1, row));
        this.cursorCol = Math.max(0, Math.min(this.cols - 1, col));
        break;
      }
      case "r": {
        const top = toIntAllowZero(parts[0], 1);
        const bottom = toIntAllowZero(parts[1], this.rows);
        this._setScrollRegion(top, bottom);
        break;
      }
      case "L": {
        const count = toInt(parts[0], 1);
        this._insertLines(count);
        break;
      }
      case "M": {
        const count = toInt(parts[0], 1);
        this._deleteLines(count);
        break;
      }
      case "S": {
        const count = toInt(parts[0], 1);
        this._scrollRegionUp(count);
        break;
      }
      case "T": {
        const count = toInt(parts[0], 1);
        this._scrollRegionDown(count);
        break;
      }
      case "@": {
        const count = toInt(parts[0], 1);
        this._insertChars(count);
        break;
      }
      case "P": {
        const count = toInt(parts[0], 1);
        this._deleteChars(count);
        break;
      }
      case "X": {
        const count = toInt(parts[0], 1);
        this._eraseChars(count);
        break;
      }
      case "J": {
        const mode = toIntAllowZero(parts[0], 0);
        this._eraseDisplay(mode);
        break;
      }
      case "K": {
        const mode = toIntAllowZero(parts[0], 0);
        this._eraseLine(mode);
        break;
      }
      case "m": {
        this._handleSgr(parts);
        break;
      }
      case "s": {
        this.savedCursor = { row: this.cursorRow, col: this.cursorCol };
        break;
      }
      case "u": {
        this.cursorRow = this.savedCursor.row;
        this.cursorCol = this.savedCursor.col;
        break;
      }
      case "h":
      case "l": {
        if (prefix === "?") {
          const values = parts.map((value) => parseInt(value, 10));
          const enable = finalChar === "h";
          if (values.includes(25)) {
            this.cursorVisible = enable;
          }
          if (values.some((value) => value === 1049 || value === 1047 || value === 47)) {
            this._useAltScreen(enable);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  _useAltScreen(enable) {
    const wasAlt = this.useAlt;
    if (enable && !this.useAlt) {
      this.mainCursor = { row: this.cursorRow, col: this.cursorCol };
      this.useAlt = true;
      this.altScreen = this._createScreen(this.rows, this.cols);
      this.cursorRow = 0;
      this.cursorCol = 0;
    } else if (!enable && this.useAlt) {
      this.altCursor = { row: this.cursorRow, col: this.cursorCol };
      this.useAlt = false;
      this.cursorRow = this.mainCursor.row;
      this.cursorCol = this.mainCursor.col;
    }
    if (this.useAlt !== wasAlt) {
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
      this._markAllDirty();
    }
  }

  _writeChar(ch) {
    if (this.cursorRow < 0 || this.cursorRow >= this.rows) {
      return;
    }
    if (this.cursorCol < 0 || this.cursorCol >= this.cols) {
      return;
    }
    const screen = this._activeScreen();
    screen[this.cursorRow][this.cursorCol] = this._makeCell(ch);
    this._markDirty(this.cursorRow);
    this.cursorCol += 1;
    if (this.cursorCol >= this.cols) {
      this.cursorCol = 0;
      this._lineFeed();
    }
  }

  _lineFeed() {
    if (this.cursorRow >= this.scrollBottom) {
      this.cursorRow = this.scrollBottom;
      this._scrollRegionUp(1);
      return;
    }
    this.cursorRow = Math.min(this.rows - 1, this.cursorRow + 1);
  }

  _tab() {
    const next = Math.floor(this.cursorCol / 8 + 1) * 8;
    const target = Math.min(next, this.cols - 1);
    while (this.cursorCol < target) {
      this._writeChar(" ");
    }
  }

  _scrollUp() {
    this._scrollRegionUp(1);
  }

  _reverseIndex() {
    if (this.cursorRow <= this.scrollTop) {
      this.cursorRow = this.scrollTop;
      this._scrollRegionDown(1);
      return;
    }
    this.cursorRow = Math.max(0, this.cursorRow - 1);
  }

  _reset() {
    this.useAlt = false;
    this.clearScrollback();
    this.screen = this._createScreen(this.rows, this.cols);
    this.altScreen = this._createScreen(this.rows, this.cols);
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.cursorVisible = true;
    this.savedCursor = { row: 0, col: 0 };
    this.mainCursor = { row: 0, col: 0 };
    this.altCursor = { row: 0, col: 0 };
    this.fg = null;
    this.bg = null;
    this.bold = false;
    this.inverse = false;
    this.state = "normal";
    this.csiBuffer = "";
    this.oscBuffer = "";
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this._markAllDirty();
  }

  _setScrollRegion(top, bottom) {
    const resolvedTop = Math.max(0, top - 1);
    const resolvedBottom = Math.min(this.rows - 1, bottom - 1);
    if (resolvedTop >= resolvedBottom) {
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
    } else {
      this.scrollTop = resolvedTop;
      this.scrollBottom = resolvedBottom;
    }
    this.cursorRow = this.scrollTop;
    this.cursorCol = 0;
  }

  _insertLines(count) {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) {
      return;
    }
    const screen = this._activeScreen();
    const max = this.scrollBottom - this.cursorRow + 1;
    const total = Math.min(count, max);
    if (total <= 0) {
      return;
    }
    for (let i = 0; i < total; i += 1) {
      screen.splice(this.cursorRow, 0, this._blankLine(this.cols, this._currentAttrs()));
      screen.splice(this.scrollBottom + 1, 1);
    }
    this._markDirtyRange(this.cursorRow, this.scrollBottom);
  }

  _deleteLines(count) {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) {
      return;
    }
    const screen = this._activeScreen();
    const max = this.scrollBottom - this.cursorRow + 1;
    const total = Math.min(count, max);
    if (total <= 0) {
      return;
    }
    for (let i = 0; i < total; i += 1) {
      screen.splice(this.cursorRow, 1);
      screen.splice(this.scrollBottom, 0, this._blankLine(this.cols, this._currentAttrs()));
    }
    this._markDirtyRange(this.cursorRow, this.scrollBottom);
  }

  _scrollRegionUp(count) {
    const screen = this._activeScreen();
    const height = this.scrollBottom - this.scrollTop + 1;
    const total = Math.min(count, height);
    if (total <= 0) {
      return;
    }
    // Only the main screen scrolling from its very top feeds scrollback:
    // the alt screen (vim, less) and DECSTBM regions must not leak into it.
    const keep = !this.useAlt && this.scrollTop === 0;
    for (let i = 0; i < total; i += 1) {
      const [evicted] = screen.splice(this.scrollTop, 1);
      if (keep && evicted) {
        this._pushScrollback(evicted);
      }
      screen.splice(this.scrollBottom, 0, this._blankLine(this.cols, this._currentAttrs()));
    }
    this._markDirtyRange(this.scrollTop, this.scrollBottom);
  }

  _scrollRegionDown(count) {
    const screen = this._activeScreen();
    const height = this.scrollBottom - this.scrollTop + 1;
    const total = Math.min(count, height);
    if (total <= 0) {
      return;
    }
    for (let i = 0; i < total; i += 1) {
      screen.splice(this.scrollBottom, 1);
      screen.splice(this.scrollTop, 0, this._blankLine(this.cols, this._currentAttrs()));
    }
    this._markDirtyRange(this.scrollTop, this.scrollBottom);
  }

  _insertChars(count) {
    if (this.cursorRow < 0 || this.cursorRow >= this.rows) {
      return;
    }
    if (this.cursorCol < 0 || this.cursorCol >= this.cols) {
      return;
    }
    const line = this._activeScreen()[this.cursorRow];
    const total = Math.min(count, this.cols - this.cursorCol);
    if (total <= 0) {
      return;
    }
    for (let col = this.cols - 1; col >= this.cursorCol + total; col -= 1) {
      line[col] = line[col - total];
    }
    const attrs = this._currentAttrs();
    for (let col = 0; col < total; col += 1) {
      line[this.cursorCol + col] = this._blankCell(attrs);
    }
    this._markDirty(this.cursorRow);
  }

  _deleteChars(count) {
    if (this.cursorRow < 0 || this.cursorRow >= this.rows) {
      return;
    }
    if (this.cursorCol < 0 || this.cursorCol >= this.cols) {
      return;
    }
    const line = this._activeScreen()[this.cursorRow];
    const total = Math.min(count, this.cols - this.cursorCol);
    if (total <= 0) {
      return;
    }
    for (let col = this.cursorCol; col < this.cols - total; col += 1) {
      line[col] = line[col + total];
    }
    const attrs = this._currentAttrs();
    for (let col = this.cols - total; col < this.cols; col += 1) {
      line[col] = this._blankCell(attrs);
    }
    this._markDirty(this.cursorRow);
  }

  _eraseChars(count) {
    if (this.cursorRow < 0 || this.cursorRow >= this.rows) {
      return;
    }
    if (this.cursorCol < 0 || this.cursorCol >= this.cols) {
      return;
    }
    const line = this._activeScreen()[this.cursorRow];
    const total = Math.min(count, this.cols - this.cursorCol);
    if (total <= 0) {
      return;
    }
    const attrs = this._currentAttrs();
    for (let col = this.cursorCol; col < this.cursorCol + total; col += 1) {
      line[col] = this._blankCell(attrs);
    }
    this._markDirty(this.cursorRow);
  }

  _eraseDisplay(mode) {
    const screen = this._activeScreen();
    const attrs = this._currentAttrs();
    if (mode === 2) {
      for (let row = 0; row < this.rows; row += 1) {
        screen[row] = this._blankLine(this.cols, attrs);
      }
      this._markAllDirty();
      return;
    }
    if (mode === 1) {
      for (let row = 0; row <= this.cursorRow; row += 1) {
        const start = row === this.cursorRow ? 0 : 0;
        const end = row === this.cursorRow ? this.cursorCol + 1 : this.cols;
        for (let col = start; col < end; col += 1) {
          screen[row][col] = this._blankCell(attrs);
        }
      }
      this._markDirtyRange(0, this.cursorRow);
      return;
    }
    const row = this.cursorRow;
    for (let col = this.cursorCol; col < this.cols; col += 1) {
      screen[row][col] = this._blankCell(attrs);
    }
    for (let r = row + 1; r < this.rows; r += 1) {
      screen[r] = this._blankLine(this.cols, attrs);
    }
    this._markDirtyRange(row, this.rows - 1);
  }

  _eraseLine(mode) {
    const screen = this._activeScreen();
    const attrs = this._currentAttrs();
    if (mode === 2) {
      screen[this.cursorRow] = this._blankLine(this.cols, attrs);
      this._markDirty(this.cursorRow);
      return;
    }
    if (mode === 1) {
      for (let col = 0; col <= this.cursorCol; col += 1) {
        screen[this.cursorRow][col] = this._blankCell(attrs);
      }
      this._markDirty(this.cursorRow);
      return;
    }
    for (let col = this.cursorCol; col < this.cols; col += 1) {
      screen[this.cursorRow][col] = this._blankCell(attrs);
    }
    this._markDirty(this.cursorRow);
  }

  _createScreen(rows, cols) {
    const screen = [];
    for (let row = 0; row < rows; row += 1) {
      screen.push(this._blankLine(cols));
    }
    return screen;
  }

  _resizeScreen(screen, rows, cols) {
    const resized = [];
    for (let row = 0; row < rows; row += 1) {
      if (row < screen.length) {
        const line = screen[row].slice(0, cols);
        while (line.length < cols) {
          line.push(this._blankCell());
        }
        resized.push(line);
      } else {
        resized.push(this._blankLine(cols));
      }
    }
    return resized;
  }

  _blankLine(cols, attrs = null) {
    return Array.from({ length: cols }, () => this._blankCell(attrs));
  }

  _blankCell(attrs = null) {
    const fill = attrs || {
      fg: null,
      bg: null,
      bold: false,
      inverse: false,
    };
    return {
      ch: " ",
      fg: fill.fg,
      bg: fill.bg,
      bold: fill.bold,
      inverse: fill.inverse,
    };
  }

  _makeCell(ch) {
    return {
      ch,
      fg: this.fg,
      bg: this.bg,
      bold: this.bold,
      inverse: this.inverse,
    };
  }

  _currentAttrs() {
    return {
      fg: this.fg,
      bg: this.bg,
      bold: this.bold,
      inverse: this.inverse,
    };
  }

  _activeScreen() {
    return this.useAlt ? this.altScreen : this.screen;
  }

  _markDirty(row) {
    if (this.dirtyAll) {
      return;
    }
    if (row < 0 || row >= this.rows) {
      return;
    }
    this.dirtyRows.add(row);
  }

  _markDirtyRange(start, end) {
    if (this.dirtyAll) {
      return;
    }
    const from = Math.max(0, start);
    const to = Math.min(this.rows - 1, end);
    for (let row = from; row <= to; row += 1) {
      this.dirtyRows.add(row);
    }
  }

  _markAllDirty() {
    this.dirtyAll = true;
    this.dirtyRows.clear();
  }

  _handleSgr(parts) {
    const codes = parts.length ? parts.map((value) => parseInt(value, 10)) : [0];
    let i = 0;
    while (i < codes.length) {
      const code = Number.isNaN(codes[i]) ? 0 : codes[i];
      if (code === 0) {
        this.fg = null;
        this.bg = null;
        this.bold = false;
        this.inverse = false;
        i += 1;
        continue;
      }
      if (code === 1) {
        this.bold = true;
        i += 1;
        continue;
      }
      if (code === 22) {
        this.bold = false;
        i += 1;
        continue;
      }
      if (code === 7) {
        this.inverse = true;
        i += 1;
        continue;
      }
      if (code === 27) {
        this.inverse = false;
        i += 1;
        continue;
      }
      if (code === 39) {
        this.fg = null;
        i += 1;
        continue;
      }
      if (code === 49) {
        this.bg = null;
        i += 1;
        continue;
      }
      if (code >= 30 && code <= 37) {
        this.fg = ANSI_COLORS[code - 30];
        i += 1;
        continue;
      }
      if (code >= 90 && code <= 97) {
        this.fg = ANSI_BRIGHT[code - 90];
        i += 1;
        continue;
      }
      if (code >= 40 && code <= 47) {
        this.bg = ANSI_COLORS[code - 40];
        i += 1;
        continue;
      }
      if (code >= 100 && code <= 107) {
        this.bg = ANSI_BRIGHT[code - 100];
        i += 1;
        continue;
      }
      if (code === 38 || code === 48) {
        const isBg = code === 48;
        const mode = codes[i + 1];
        if (mode === 5 && typeof codes[i + 2] !== "undefined") {
          const color = colorFrom256(codes[i + 2]);
          if (color) {
            if (isBg) {
              this.bg = color;
            } else {
              this.fg = color;
            }
          }
          i += 3;
          continue;
        }
        if (
          mode === 2 &&
          typeof codes[i + 2] !== "undefined" &&
          typeof codes[i + 3] !== "undefined" &&
          typeof codes[i + 4] !== "undefined"
        ) {
          const r = Math.max(0, Math.min(255, codes[i + 2]));
          const g = Math.max(0, Math.min(255, codes[i + 3]));
          const b = Math.max(0, Math.min(255, codes[i + 4]));
          const color = `rgb(${r}, ${g}, ${b})`;
          if (isBg) {
            this.bg = color;
          } else {
            this.fg = color;
          }
          i += 5;
          continue;
        }
      }
      i += 1;
    }
  }

  _renderLine(line) {
    let html = "";
    let buffer = "";
    let styleKey = null;
    let styleCss = null;

    const flush = () => {
      if (!buffer) {
        return;
      }
      const escaped = escapeHtml(buffer);
      if (styleCss) {
        html += `<span style="${styleCss}">${escaped}</span>`;
      } else {
        html += escaped;
      }
      buffer = "";
    };

    for (const cell of line) {
      const style = this._styleForCell(cell);
      if (style.key !== styleKey) {
        flush();
        styleKey = style.key;
        styleCss = style.css;
      }
      buffer += cell.ch;
    }

    flush();
    return html;
  }

  _styleForCell(cell) {
    let fg = cell.fg || DEFAULT_FG;
    let bg = cell.bg || DEFAULT_BG;
    if (cell.inverse) {
      const temp = fg;
      fg = bg;
      bg = temp;
    }
    const bold = cell.bold;
    const isDefault = fg === DEFAULT_FG && bg === DEFAULT_BG && !bold;
    if (isDefault) {
      return { key: "default", css: null };
    }
    const css = `color:${fg};background-color:${bg};${bold ? "font-weight:600;" : ""}`;
    return { key: `${fg}|${bg}|${bold ? 1 : 0}`, css };
  }
}

export class TerminalView {
  /**
   * @param {HTMLElement} hostEl      scrolling viewport
   * @param {HTMLElement} textEl      live screen rows (position: relative)
   * @param {HTMLElement} cursorEl    cursor block, a child of textEl
   * @param {HTMLElement} scrollbackEl  rows that scrolled off, above textEl
   */
  constructor(hostEl, textEl, cursorEl, scrollbackEl) {
    this.hostEl = hostEl;
    this.textEl = textEl;
    this.cursorEl = cursorEl;
    this.scrollbackEl = scrollbackEl || null;
    this.cell = { width: 8, height: 16 };
    this.emulator = new TerminalEmulator(24, 80);
    this.renderPending = false;
    this.rowEls = [];
    this.scrollbackEls = [];
    this.stickToBottom = true;

    this.hostEl.addEventListener("scroll", () => {
      this.stickToBottom = this._isNearBottom();
    });
  }

  /** Re-measure the cell grid and tell the emulator its new size. */
  resizeToFit() {
    this._measure();
    const cols = Math.max(20, Math.floor(this.textEl.clientWidth / this.cell.width));
    const rows = Math.max(5, Math.floor(this.hostEl.clientHeight / this.cell.height));
    this.emulator.resize(rows, cols);
    this._ensureRows(rows);
    this._render();
    return { cols, rows };
  }

  write(bytes) {
    this.emulator.write(bytes);
    this._scheduleRender();
  }

  /** Plain text of scrollback + live screen, for "copy all". */
  toText() {
    const lines = this.emulator.scrollback.map((line) =>
      line.map((cell) => cell.ch).join("").replace(/\s+$/, ""),
    );
    for (let row = 0; row < this.emulator.rows; row += 1) {
      lines.push(this.emulator.renderRowText(row));
    }
    return lines.join("\n").replace(/\n+$/, "") + "\n";
  }

  clear() {
    this.emulator.clearScrollback();
    for (const el of this.scrollbackEls) {
      el.remove();
    }
    this.scrollbackEls.length = 0;
    this.scrollToBottom();
  }

  scrollToBottom() {
    this.stickToBottom = true;
    this.hostEl.scrollTop = this.hostEl.scrollHeight;
  }

  scrollByPage(direction) {
    const page = Math.max(1, this.emulator.rows - 1) * this.cell.height;
    this.hostEl.scrollTop += direction * page;
    this.stickToBottom = this._isNearBottom();
  }

  _isNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = this.hostEl;
    return scrollHeight - (scrollTop + clientHeight) <= this.cell.height;
  }

  _scheduleRender() {
    if (this.renderPending) {
      return;
    }
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this._render();
    });
  }

  _render() {
    const wasAtBottom = this.stickToBottom;
    this._drainScrollback();

    const dirty = this.emulator.consumeDirtyRows();
    if (dirty) {
      this._ensureRows(this.emulator.rows);
      if (dirty.all) {
        for (let row = 0; row < this.emulator.rows; row += 1) {
          this.rowEls[row].innerHTML = this.emulator.renderRow(row);
        }
      } else {
        for (const row of dirty.rows) {
          if (row >= 0 && row < this.emulator.rows) {
            this.rowEls[row].innerHTML = this.emulator.renderRow(row);
          }
        }
      }
    }
    this._updateCursor();
    if (wasAtBottom) {
      this.scrollToBottom();
    }
  }

  /** Move lines the emulator retired into the scrollback DOM. */
  _drainScrollback() {
    if (!this.scrollbackEl) {
      this.emulator.consumeScrollback();
      return;
    }
    const pending = this.emulator.consumeScrollback();
    if (pending.length === 0) {
      return;
    }
    const fragment = document.createDocumentFragment();
    const base = this.emulator.scrollback.length - pending.length;
    for (let i = 0; i < pending.length; i += 1) {
      const rowEl = document.createElement("div");
      rowEl.className = "terminal-row";
      rowEl.innerHTML = this.emulator.renderScrollbackLine(base + i);
      fragment.appendChild(rowEl);
      this.scrollbackEls.push(rowEl);
    }
    this.scrollbackEl.appendChild(fragment);

    // Keep the DOM in step with the emulator's own scrollback cap.
    const overflow = this.scrollbackEls.length - this.emulator.scrollbackLimit;
    if (overflow > 0) {
      for (const el of this.scrollbackEls.splice(0, overflow)) {
        el.remove();
      }
    }
  }

  _ensureRows(rows) {
    const current = this.rowEls.length;
    if (current > rows) {
      for (let i = rows; i < current; i += 1) {
        this.rowEls[i].remove();
      }
      this.rowEls.length = rows;
    }
    if (current < rows) {
      const fragment = document.createDocumentFragment();
      for (let i = current; i < rows; i += 1) {
        const rowEl = document.createElement("div");
        rowEl.className = "terminal-row";
        fragment.appendChild(rowEl);
        this.rowEls.push(rowEl);
      }
      this.textEl.appendChild(fragment);
    }
  }

  _measure() {
    const probe = document.createElement("span");
    probe.className = "probe";
    const sampleSize = 10;
    probe.textContent = "M".repeat(sampleSize);
    this.textEl.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();

    const styles = window.getComputedStyle(this.textEl);
    const lineHeight = parseFloat(styles.lineHeight);
    const fontSize = parseFloat(styles.fontSize);

    this.cell = {
      width: rect.width > 0 ? rect.width / sampleSize : 8,
      height: Number.isFinite(lineHeight)
        ? lineHeight
        : rect.height || (Number.isFinite(fontSize) ? fontSize * 1.3 : 16),
    };
    this.cursorEl.style.width = `${this.cell.width}px`;
    this.cursorEl.style.height = `${this.cell.height}px`;
  }

  // The cursor lives inside textEl, so its origin is the live screen itself
  // and growing scrollback above never shifts it.
  _updateCursor() {
    const x = this.emulator.cursorCol * this.cell.width;
    const y = this.emulator.cursorRow * this.cell.height;
    this.cursorEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    this.cursorEl.style.opacity = this.emulator.cursorVisible ? "1" : "0";
  }
}
