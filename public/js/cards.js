// Project card: render + patch + all card-level actions.
import { api } from './api.js';
import { icons } from './icons.js';
import { toastError, toastSuccess, toastInfo } from './toast.js';
import { getProject, updateProject, patchProject, addRecent, setScriptRunning, clearScriptRunning, getScriptRunning } from './state.js';
import { openLogPanel } from './logs.js';
import { openChangePortDialog, openEditPathDialog, openDeleteDialog, openMoveGroupDialog } from './dialogs.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { running: 'Running', stopped: 'Stopped', crashed: 'Crashed', starting: 'Starting' };

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
  const scriptRunning = getScriptRunning(p.id);
  const blocked = running || busy || !!scriptRunning;
  return `
    <div class="card__head">
      <span class="pill pill--${p.status}">${STATUS_LABEL[p.status]}</span>
      <h3 class="card__name" title="${esc(p.name)}">${esc(p.name)}</h3>
    </div>
    ${scriptRunning ? `<div class="card__script-running"><span class="btn__spinner"></span> Running: ${esc(scriptRunning)} <button data-act="cancel-script" class="btn btn--sm btn--danger">✕ Cancel</button></div>` : ''}
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
        ? `<button class="btn btn--sm btn--danger" data-act="stop">${icons.stop} Stop</button>
           <button class="btn btn--sm" data-act="restart">${icons.restart} Restart</button>`
        : busy
          ? `<button class="btn btn--sm" disabled><span class="btn__spinner"></span> Starting…</button>`
          : `<button class="btn btn--sm" data-act="restart" ${p.status === 'crashed' ? '' : 'disabled'}>${icons.restart} Restart</button>`}
      <button class="btn btn--sm" data-act="install">${icons.install} Install</button>
      <button class="btn btn--sm" data-act="build">${icons.build} Build</button>
    </div>
    <div class="card__scripts">
      <span class="card__scripts-label">Scripts</span>
      ${p.scripts.map((s) => `<button class="btn btn--sm" data-script="${esc(s)}" ${blocked ? 'disabled' : ''}>${esc(s)}</button>`).join('')}
    </div>
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

    if (script) {
      // dev/start saat stopped/crashed → start service (show running badge)
      if ((p.status === 'stopped' || p.status === 'crashed') && (script === 'dev' || script === 'start')) {
        setScriptRunning(p.id, script);
        api.startProject(p.id)
          .then((updated) => { clearScriptRunning(p.id); if (updated) updateProject(updated, { structural: false }); })
          .catch((err) => { clearScriptRunning(p.id); toastError(err.message); });
        return;
      }
      // Script lain → one-shot dengan running indicator
      setScriptRunning(p.id, script);
      withSpinner(btn, () =>
        api.runScript(p.id, script)
          .then(() => { clearScriptRunning(p.id); toastSuccess(`Script "${script}" finished`); })
          .catch((err) => { clearScriptRunning(p.id); toastError(err.message); })
      );
      return;
    }

    switch (act) {
      case 'stop':
        run(p.id, () => api.stopProject(p.id));
        break;
      case 'restart':
        run(p.id, () => api.restartProject(p.id), {
          optimistic: { status: 'starting' },
          recent: true,
        });
        break;
      case 'install':
        withSpinner(btn, () =>
          api.install(p.id)
            .then(() => toastSuccess('Dependencies installed'))
            .catch((err) => toastError(err.message))
        );
        break;
      case 'build':
        withSpinner(btn, () =>
          api.runScript(p.id, 'build')
            .then(() => toastSuccess('Build finished'))
            .catch((err) => toastError(err.message))
        );
        break;
      case 'cancel-script': {
        if (p.status === 'running' || p.status === 'starting') {
          // StartProject — cancel via stopProject
          api.stopProject(p.id)
            .then((updated) => { clearScriptRunning(p.id); if (updated) updateProject(updated, { structural: false }); toastInfo('Service stopped'); })
            .catch((err) => toastError(err.message));
        } else {
          // runScript — cancel via cancelScript
          api.cancelScript(p.id)
            .then(() => { clearScriptRunning(p.id); toastInfo('Script cancelled'); })
            .catch((err) => toastError(err.message));
        }
        break;
      }
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
