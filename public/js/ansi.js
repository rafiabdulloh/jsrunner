// Minimal ANSI → HTML. Dev servers emit colour codes constantly; without this
// the log panel shows raw escape sequences like "[32m✓[39m".
const FG = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow',
  34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'gray', 91: 'red', 92: 'green', 93: 'yellow',
  94: 'blue', 95: 'magenta', 96: 'cyan', 97: 'white',
};
const BG = {
  40: 'black', 41: 'red', 42: 'green', 43: 'yellow',
  44: 'blue', 45: 'magenta', 46: 'cyan', 47: 'white',
};
// Style codes and the code that turns each one back off
const STYLE = {
  1: { kind: 'weight', cls: 'ansi-bold' },
  2: { kind: 'weight', cls: 'ansi-dim' },
  3: { kind: 'italic', cls: 'ansi-italic' },
  4: { kind: 'underline', cls: 'ansi-underline' },
};
const CLOSERS = { 22: 'weight', 23: 'italic', 24: 'underline', 39: 'fg', 49: 'bg' };

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// SGR (colour) sequences are rendered; everything else is control noise
const SGR = /\x1b\[([0-9;]*)m/g;
const OTHER_ESCAPES = [
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, // OSC (window title)
  /\x1b\[[0-9;?]*[A-Za-z]/g,            // CSI: cursor moves, erase line, …
  /\x1b[()][0-9A-Za-z]/g,               // charset selection
  /\x1b[=>]/g,                          // keypad modes
  /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,  // stray control chars (keep \t and \n)
];

function stripControl(text) {
  let out = text;
  for (const re of OTHER_ESCAPES) out = out.replace(re, '');
  return out;
}

/**
 * Convert a log line to safe HTML, translating colour codes to spans.
 * Text is escaped before any markup is added.
 */
export function ansiToHtml(text) {
  const input = String(text);
  if (!input.includes('\x1b')) return esc(stripControl(input));

  // Open spans, innermost last — needed because a closer like 39 (default
  // foreground) must close just the colour, not whatever nests above it.
  const stack = [];

  const open = (kind, cls) => {
    stack.push({ kind, cls });
    return `<span class="${cls}">`;
  };

  const closeKind = (kind) => {
    let at = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === kind) { at = i; break; }
    }
    if (at === -1) return '';
    // Unwind to the target, then put back everything that was above it
    let html = '</span>'.repeat(stack.length - at);
    const above = stack.splice(at).slice(1);
    for (const s of above) html += `<span class="${s.cls}">`;
    stack.push(...above);
    return html;
  };

  const closeAll = () => {
    const html = '</span>'.repeat(stack.length);
    stack.length = 0;
    return html;
  };

  let html = '';
  let last = 0;
  SGR.lastIndex = 0;

  let match;
  while ((match = SGR.exec(input)) !== null) {
    html += esc(stripControl(input.slice(last, match.index)));
    last = SGR.lastIndex;

    const codes = match[1] === '' ? [0] : match[1].split(';').map((n) => parseInt(n, 10) || 0);
    for (const code of codes) {
      if (code === 0) {
        html += closeAll();
      } else if (CLOSERS[code]) {
        html += closeKind(CLOSERS[code]);
      } else if (STYLE[code]) {
        html += open(STYLE[code].kind, STYLE[code].cls);
      } else if (FG[code]) {
        html += closeKind('fg') + open('fg', `ansi-fg-${FG[code]}`);
      } else if (BG[code]) {
        html += closeKind('bg') + open('bg', `ansi-bg-${BG[code]}`);
      }
      // 256-colour / truecolour (38;5;n, 38;2;r;g;b) and anything else: ignored
    }
  }

  html += esc(stripControl(input.slice(last)));
  html += closeAll();
  return html;
}

/**
 * Plain text with all escapes removed — used for copy/download/search.
 */
export function stripAnsi(text) {
  return stripControl(String(text).replace(SGR, ''));
}
