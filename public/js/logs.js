// Log drawer: SSE-driven (with a 1s poll fallback), ANSI colours, filter,
// copy/download/clear/pause-scroll.
import { api } from './api.js';
import { icons } from './icons.js';
import { getProject } from './state.js';
import { toastError, toastSuccess } from './toast.js';
import { ansiToHtml, stripAnsi } from './ansi.js';

let panel = null;
let timer = null;
let cursor = 0;
let autoScroll = true;
let currentId = null;
let filterText = '';
let lines = []; // { text, err } for the open project

function build() {
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.addEventListener('click', closeLogPanel);
  document.body.appendChild(backdrop);

  panel = document.createElement('aside');
  panel.className = 'drawer';
  panel.setAttribute('aria-label', 'Project logs');
  panel.innerHTML = `
    <div class="drawer__header">
      <span class="drawer__title"></span>
      <div class="drawer__controls">
        <button class="btn btn--sm btn--icon" data-lact="copy" title="Copy log">${icons.copy}</button>
        <button class="btn btn--sm btn--icon" data-lact="download" title="Download log">${icons.install}</button>
        <button class="btn btn--sm btn--icon" data-lact="clear" title="Clear log">${icons.trash}</button>
        <button class="btn btn--sm btn--icon" data-lact="pause" title="Pause auto scroll">${icons.pause}</button>
        <button class="btn btn--sm btn--icon" data-lact="close" title="Close">${icons.x}</button>
      </div>
    </div>
    <div class="drawer__filter">
      <input class="drawer__search" type="search" placeholder="Filter lines…" spellcheck="false">
      <span class="drawer__count"></span>
    </div>
    <div class="drawer__body"></div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('.drawer__body');
  panel.querySelector('[data-lact="close"]').addEventListener('click', closeLogPanel);
  panel.querySelector('[data-lact="copy"]').addEventListener('click', copyLogs);
  panel.querySelector('[data-lact="download"]').addEventListener('click', downloadLogs);
  panel.querySelector('[data-lact="clear"]').addEventListener('click', clearLogs);
  panel.querySelector('[data-lact="pause"]').addEventListener('click', (e) => {
    autoScroll = !autoScroll;
    const btn = e.currentTarget;
    btn.innerHTML = autoScroll ? icons.pause : icons.resume;
    btn.title = autoScroll ? 'Pause auto scroll' : 'Resume auto scroll';
  });
  panel.querySelector('.drawer__search').addEventListener('input', (e) => {
    filterText = e.target.value.trim().toLowerCase();
    render();
  });
  // Pause auto scroll when the user scrolls up manually.
  body.addEventListener('wheel', (e) => {
    if (e.deltaY < 0 && autoScroll) panel.querySelector('[data-lact="pause"]').click();
  });
}

async function poll() {
  if (!currentId) return;
  try {
    const { lines: fresh, total } = await api.fetchLogs(currentId, cursor);
    if (!currentId) return; // closed while awaiting
    if (total < cursor) {
      // buffer was cleared elsewhere — start over
      cursor = 0;
      lines = [];
    }
    if (fresh.length) {
      lines.push(...fresh);
      render({ append: fresh });
    }
    cursor = total;
  } catch (err) {
    toastError(err.message);
    closeLogPanel();
  }
}

function lineEl(line) {
  const div = document.createElement('div');
  div.className = `drawer__line${line.err ? ' drawer__line--err' : ''}${line.history ? ' drawer__line--history' : ''}`;
  div.innerHTML = ansiToHtml(line.text);
  return div;
}

const matches = (line) => !filterText || stripAnsi(line.text).toLowerCase().includes(filterText);

function updateCount() {
  const countEl = panel.querySelector('.drawer__count');
  if (!countEl) return;
  countEl.textContent = filterText
    ? `${lines.filter(matches).length} / ${lines.length} lines`
    : `${lines.length} line${lines.length === 1 ? '' : 's'}`;
}

/**
 * Repaint the body. `append` re-renders only the new lines, which keeps a
 * chatty dev server from rebuilding the whole list on every frame.
 */
function render({ append } = {}) {
  const body = panel.querySelector('.drawer__body');

  if (lines.length === 0) {
    body.replaceChildren();
    const div = document.createElement('div');
    div.className = 'drawer__empty';
    div.textContent = 'No logs yet. Start the project to see output.';
    body.appendChild(div);
    updateCount();
    return;
  }

  if (append) {
    body.querySelector('.drawer__empty')?.remove();
    for (const line of append) {
      if (matches(line)) body.appendChild(lineEl(line));
    }
  } else {
    body.replaceChildren();
    const visible = lines.filter(matches);
    if (visible.length === 0) {
      const div = document.createElement('div');
      div.className = 'drawer__empty';
      div.textContent = `No lines match "${filterText}"`;
      body.appendChild(div);
    } else {
      const frag = document.createDocumentFragment();
      for (const line of visible) frag.appendChild(lineEl(line));
      body.appendChild(frag);
    }
  }

  updateCount();
  if (autoScroll) body.scrollTop = body.scrollHeight;
}

export function openLogPanel(id) {
  if (!panel) build();
  closeLogPanel(); // reset any previous session, keep the DOM node
  const p = getProject(id);
  if (!p) return;

  currentId = id;
  cursor = 0;
  lines = [];
  filterText = '';
  autoScroll = true;
  panel.querySelector('.drawer__search').value = '';
  panel.querySelector('[data-lact="pause"]').innerHTML = icons.pause;
  panel.querySelector('.drawer__title').textContent = `${p.name} — logs`;
  render();
  panel.classList.add('drawer--open');
  const bd = document.querySelector('.drawer-backdrop');
  if (bd) bd.classList.add('drawer-backdrop--visible');
  poll();
  // Fallback ticker: harmless when SSE is live, essential when it is not
  timer = setInterval(poll, 1000);
}

export function closeLogPanel() {
  if (timer) clearInterval(timer);
  timer = null;
  currentId = null;
  lines = [];
  if (panel) {
    panel.classList.remove('drawer--open');
    const bd = document.querySelector('.drawer-backdrop');
    if (bd) bd.classList.remove('drawer-backdrop--visible');
  }
}

/**
 * SSE told us this project produced output — pull the delta immediately.
 */
export function notifyLogUpdate(ids) {
  if (currentId && ids.includes(currentId)) poll();
}

const plainText = () => lines.map((l) => stripAnsi(l.text).replace(/\r?\n$/, '')).join('\n');

async function copyLogs() {
  const text = plainText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess('Log copied to clipboard');
  } catch {
    // Clipboard API needs a secure context in some setups; fall back.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toastSuccess('Log copied to clipboard');
  }
}

function downloadLogs() {
  const text = plainText();
  if (!text) return;
  const p = getProject(currentId);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p?.name || 'project'}-${stamp}.log`.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
  toastSuccess(`Saved ${a.download}`);
}

async function clearLogs() {
  if (!currentId) return;
  try {
    await api.clearLogs(currentId);
    cursor = 0;
    lines = [];
    render();
  } catch (err) {
    toastError(err.message);
  }
}

// If a project's card disappears (deleted), close its panel.
export function syncLogPanel() {
  if (currentId && !getProject(currentId)) closeLogPanel();
}
