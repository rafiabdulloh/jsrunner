// Project card: render + patch + all card-level actions.
import { api } from './api.js';
import { icons } from './icons.js';
import { toastError, toastSuccess } from './toast.js';
import { getProject, updateProject, patchProject, addRecent } from './state.js';
import { openLogPanel } from './logs.js';
import { openChangePortDialog, openEditPathDialog, openDeleteDialog, openMoveGroupDialog, openServiceDialog } from './dialogs.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { running: 'Running', stopped: 'Stopped', crashed: 'Crashed', starting: 'Starting' };

const blocking = new Map(); // projectId -> 'install' | 'build' | undefined
const clickLock = new Set(); // `${projectId}:${script}` in-flight click keys

export function formatUptime(startedAt) {
  if (!startedAt) return '—';
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function metaRow(label, value, dataAttr, id, title) {
  const val = value ?? '—';
  const titleAttr = title ? ` title="${esc(title)}"` : '';
  return `<div><dt>${label}</dt><dd${dataAttr ? ` data-${dataAttr}="${id}"` : ''}${titleAttr}>${esc(val)}</dd></div>`;
}

export function renderCard(p) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = p.id;
  if (p.color) {
    el.dataset.color = p.color;
    el.style.setProperty('--card-color', p.color);
  }
  el.innerHTML = cardHtml(p);
  wire(el, p);
  return el;
}

function cardHtml(p) {
  const running = p.status === 'running';
  const busy = p.status === 'starting';
  const fw = p.framework.toLowerCase();
  const services = p.runningServices || [];
  const block = blocking.get(p.id);
  const anyRunning = services.length > 0;
  const runningParent = services.some((s) => s.script === 'dev' || s.script === 'start');
  const serviceRunning = anyRunning && !runningParent;
  const isParentScript = (s) => s === 'dev' || s === 'start';
  const scriptDisabled = (s) => busy || !!block || runningParent || (serviceRunning && isParentScript(s)) || services.some((x) => x.script === s);
  const actionDisabled = busy || !!block || anyRunning;
  const VISIBLE_SCRIPT = (s) => s === 'dev' || s === 'start' || s.startsWith('dev:') || s.startsWith('start:');
  const visibleScripts = p.scripts.filter(VISIBLE_SCRIPT);
  return `
    <div class="card__head">
      <span class="pill pill--${p.status}">${STATUS_LABEL[p.status]}</span>
      <h3 class="card__name" title="${esc(p.name)}">${esc(p.name)}</h3>
    </div>
    ${services.length > 0 ? `<div class="card__services">${services.map(s => `
      <div class="card__service">
        <span class="card__service-dot"></span>
        <span class="card__service-name">${esc(s.script)}</span>
        <span class="card__service-pid">PID ${s.pid}</span>
        <button class="btn btn--sm btn--danger" data-act="stop-service" data-script="${esc(s.script)}">${icons.stop} Stop</button>
        <button class="btn btn--sm" data-act="service-logs" data-script="${esc(s.script)}">${icons.terminal} Log</button>
      </div>`).join('')}</div>` : ''}
    <div class="card__badges">
      <span class="badge badge--${esc(fw)}">${esc(p.framework)}</span>
      <span class="badge badge--pm">${esc(p.pm)}</span>
    </div>
    <dl class="card__meta">
      ${metaRow('Folder', p.folder, null, null, p.folder)}
      ${metaRow('Port', p.port ?? 'n/a')}
      ${metaRow('PID', running ? p.pid : null, 'pid', p.id)}
      ${metaRow('Uptime', running ? formatUptime(p.startedAt) : null, 'uptime', p.id)}
    </dl>
    <div class="card__actions">
      ${running
        ? `<button class="btn btn--sm btn--danger" data-act="stop">${icons.stop} Stop All</button>`
        : busy
          ? `<button class="btn btn--sm" disabled><span class="btn__spinner"></span> Starting…</button>`
          : `<button class="btn btn--sm" data-act="restart" ${p.status === 'crashed' ? '' : 'disabled'}>${icons.restart} Restart</button>`}
      <button class="btn btn--sm" data-act="install" ${actionDisabled ? 'disabled' : ''}>${icons.install} Install</button>
      <button class="btn btn--sm" data-act="build" ${actionDisabled ? 'disabled' : ''}>${icons.build} Build</button>
    </div>
    ${visibleScripts.length ? `
    <div class="card__scripts">
      <span class="card__scripts-label">Scripts</span>
      ${visibleScripts.map((s) => `<button class="btn btn--sm" data-script="${esc(s)}" ${scriptDisabled(s) ? 'disabled' : ''}>${esc(s)}</button>`).join('')}
    </div>` : ''}
    <div class="card__footer">
      <button class="btn btn--sm btn--icon" data-act="group" title="Move to group">${icons.folder}</button>
      <span class="spacer"></span>
      <button class="btn btn--sm btn--icon" data-act="logs" title="View logs">${icons.terminal}</button>
      <button class="btn btn--sm btn--icon" data-act="port" title="Change port">${icons.port}</button>
      <button class="btn btn--sm btn--icon" data-act="rescan" title="Rescan package.json">${icons.refresh}</button>
      <button class="btn btn--sm btn--icon" data-act="edit" title="Edit path">${icons.edit}</button>
      <button class="btn btn--sm btn--icon btn--danger" data-act="delete" title="Delete project">${icons.trash}</button>
    </div>
    ${p.subProjects?.length > 0 ? `
    <div class="card__subprojects">
      <span class="card__subprojects-label">Sub-projects</span>
      ${p.subProjects.map(sp => `
        <div class="card__subproject">
          <span>${esc(sp.name)}</span>
          <span class="card__subproject-port">${sp.port ?? 'n/a'}</span>
          <button class="btn btn--sm" data-act="port-sub" data-target="${esc(sp.name)}">Edit</button>
        </div>`).join('')}
    </div>` : ''}`;
}

// Replace card content in place (status/actions changed).
export function patchCard(p) {
  const el = document.querySelector(`.card[data-id="${p.id}"]`);
  if (!el) return;
  el.innerHTML = cardHtml(p);
}

async function run(id, action, { optimistic, success, recent = false } = {}) {
  if (optimistic) patchProject(id, optimistic);
  try {
    const updated = await action();
    if (updated) updateProject(updated, { structural: false });
    if (recent) addRecent(id);
    if (success) toastSuccess(success);
    return updated;
  } catch (err) {
    toastError(err.message);
    // Roll back an optimistic "starting" state on failure.
    if (optimistic) patchProject(id, { status: 'stopped' });
    return null;
  }
}

function withSpinner(btn, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn__spinner"></span>`;
  return fn().finally(() => {
    btn.disabled = false;
    btn.innerHTML = original;
  });
}

function wire(el, p) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const script = btn.dataset.script;

    if (script && !act) {
      const lockKey = `${p.id}:${script}`;
      if (clickLock.has(lockKey)) return;
      clickLock.add(lockKey);
      setTimeout(() => clickLock.delete(lockKey), 400);
      // Scripts section only contains dev/start/dev:*/start:* (filtered in cardHtml)
      const isParent = script === 'dev' || script === 'start';
      if (isParent && (p.status === 'stopped' || p.status === 'crashed')) {
        // Parent dev/start → start directly, no modal
        patchProject(p.id, { status: 'starting' }, { structural: false });
        api.startProject(p.id, script)
          .then((updated) => { if (updated) updateProject(updated, { structural: false }); })
          .catch((err) => toastError(err.message));
        return;
      }
      openServiceDialog(p.id, script);
      return;
    }

    switch (act) {
      case 'stop':
        run(p.id, () => api.stopProject(p.id));
        break;
      case 'stop-service':
        run(p.id, () => api.stopProject(p.id, btn.dataset.script));
        break;
      case 'service-logs':
        openLogPanel(p.id, btn.dataset.script);
        break;
      case 'restart':
        run(p.id, () => api.restartProject(p.id), {
          optimistic: { status: 'starting' },
          recent: true,
        });
        break;
      case 'install':
        blocking.set(p.id, 'install');
        patchCard(p);
        withSpinner(btn, () =>
          api.install(p.id)
            .then(() => toastSuccess('Dependencies installed'))
            .catch((err) => toastError(err.message))
            .finally(() => { blocking.delete(p.id); patchCard(p); })
        );
        break;
      case 'build':
        blocking.set(p.id, 'build');
        patchCard(p);
        withSpinner(btn, () =>
          api.runScript(p.id, 'build')
            .then(() => toastSuccess('Build finished'))
            .catch((err) => toastError(err.message))
            .finally(() => { blocking.delete(p.id); patchCard(p); })
        );
        break;
      case 'rescan':
        withSpinner(btn, () =>
          run(p.id, () => api.rescanProject(p.id), { success: 'Project rescanned' })
        );
        break;
      case 'logs':
        openLogPanel(p.id);
        break;
      case 'port':
        openChangePortDialog(p.id);
        break;
      case 'port-sub':
        openChangePortDialog(p.id, btn.dataset.target);
        break;
      case 'edit':
        openEditPathDialog(p.id);
        break;
      case 'group':
        openMoveGroupDialog(p.id);
        break;
      case 'delete':
        openDeleteDialog(p.id);
        break;
    }
  });

}


// Called once from main.js: ticks uptime every second for running projects.
export function startUptimeTicker(getProjects) {
  setInterval(() => {
    for (const p of getProjects()) {
      if (p.status !== 'running') continue;
      const dd = document.querySelector(`[data-uptime="${p.id}"]`);
      if (dd) dd.textContent = formatUptime(p.startedAt);
    }
  }, 1000);
}
