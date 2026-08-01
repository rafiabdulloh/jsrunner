// Log drawer: realtime polling (1s), copy/clear/pause-scroll/close.
import { api } from './api.js';
import { icons } from './icons.js';
import { getProject } from './state.js';
import { toastError, toastSuccess } from './toast.js';

let panel = null;
let timer = null;
let cursor = 0;
let autoScroll = true;
let currentId = null;
let currentScript = null;
let searchQuery = '';

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
        <button class="btn btn--sm btn--icon" data-lact="clear" title="Clear log">${icons.trash}</button>
        <button class="btn btn--sm btn--icon" data-lact="pause" title="Pause auto scroll">${icons.pause}</button>
        <button class="btn btn--sm btn--icon" data-lact="close" title="Close">${icons.x}</button>
      </div>
    </div>
    <div class="drawer__toolbar">
      <input class="drawer__search" data-lact="search" type="text" placeholder="Search logs…" spellcheck="false" autocomplete="off">
      <span class="drawer__match-count" data-lact="count"></span>
    </div>
    <div class="drawer__body"></div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('.drawer__body');
  panel.querySelector('[data-lact="close"]').addEventListener('click', closeLogPanel);
  panel.querySelector('[data-lact="copy"]').addEventListener('click', copyLogs);
  panel.querySelector('[data-lact="clear"]').addEventListener('click', clearLogs);
  panel.querySelector('[data-lact="pause"]').addEventListener('click', (e) => {
    autoScroll = !autoScroll;
    const btn = e.currentTarget;
    btn.innerHTML = autoScroll ? icons.pause : icons.resume;
    btn.title = autoScroll ? 'Pause auto scroll' : 'Resume auto scroll';
  });
  panel.querySelector('[data-lact="search"]').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applySearch();
  });
  // Pause auto scroll when the user scrolls up manually.
  body.addEventListener('wheel', (e) => {
    if (e.deltaY < 0 && autoScroll) panel.querySelector('[data-lact="pause"]').click();
  });
}

async function poll() {
  if (!currentId) return;
  try {
    const { lines, total } = await api.fetchLogs(currentId, cursor, currentScript);
    if (!currentId) return; // closed while awaiting
    if (total < cursor) cursor = 0; // buffer was cleared elsewhere
    if (lines.length) appendLines(lines);
    cursor = total;
  } catch (err) {
    toastError(err.message);
    closeLogPanel();
  }
}

function appendLines(lines) {
  const body = panel.querySelector('.drawer__body');
  body.querySelector('.drawer__empty')?.remove();
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = `drawer__line${line.err ? ' drawer__line--err' : ''}`;
    div.textContent = line.text;
    if (searchQuery.trim() && !line.text.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
      div.classList.add('drawer__line--hidden');
    }
    body.appendChild(div);
  }
  if (searchQuery.trim()) applySearch(); // refresh match count
  if (autoScroll) body.scrollTop = body.scrollHeight;
}

function renderEmpty() {
  const body = panel.querySelector('.drawer__body');
  body.replaceChildren();
  const div = document.createElement('div');
  div.className = 'drawer__empty';
  div.textContent = 'No logs yet. Start the project to see output.';
  body.appendChild(div);
  const count = panel.querySelector('[data-lact="count"]');
  if (count) count.textContent = '';
}

function applySearch() {
  const body = panel.querySelector('.drawer__body');
  const q = searchQuery.trim().toLowerCase();
  let shown = 0;
  for (const el of body.querySelectorAll('.drawer__line')) {
    const hit = !q || el.textContent.toLowerCase().includes(q);
    el.classList.toggle('drawer__line--hidden', !hit);
    if (hit) shown++;
  }
  const count = panel.querySelector('[data-lact="count"]');
  if (count) count.textContent = q ? `${shown} match${shown === 1 ? '' : 'es'}` : '';
}

export function openLogPanel(id, script) {
  if (!panel) build();
  closeLogPanel(); // reset any previous session, keep the DOM node
  const p = getProject(id);
  if (!p) return;

  currentId = id;
  currentScript = script || null;
  cursor = 0;
  autoScroll = true;
  searchQuery = '';
  const searchInput = panel.querySelector('[data-lact="search"]');
  if (searchInput) searchInput.value = '';
  panel.querySelector('[data-lact="pause"]').innerHTML = icons.pause;
  panel.querySelector('.drawer__title').textContent = script ? `${p.name} — ${script} logs` : `${p.name} — logs`;
  renderEmpty();
  panel.classList.add('drawer--open');
  const bd = document.querySelector('.drawer-backdrop');
  if (bd) bd.classList.add('drawer-backdrop--visible');
  poll();
  timer = setInterval(poll, 1000);
}

export function closeLogPanel() {
  if (timer) clearInterval(timer);
  timer = null;
  currentId = null;
  if (panel) {
    panel.classList.remove('drawer--open');
    const bd = document.querySelector('.drawer-backdrop');
    if (bd) bd.classList.remove('drawer-backdrop--visible');
  }
}

async function copyLogs() {
  const body = panel.querySelector('.drawer__body');
  const text = [...body.querySelectorAll('.drawer__line')].map((l) => l.textContent).join('\n');
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

async function clearLogs() {
  if (!currentId) return;
  try {
    await api.clearLogs(currentId);
    cursor = 0;
    renderEmpty();
  } catch (err) {
    toastError(err.message);
  }
}

// If a project's card disappears (deleted), close its panel.
export function syncLogPanel() {
  if (currentId && !getProject(currentId)) closeLogPanel();
}
