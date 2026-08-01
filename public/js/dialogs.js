// Modal dialogs: Add Project, Change Port, Edit Path, Delete confirm.
// ESC and backdrop click close; focus returns to the opener.
import { api } from './api.js';
import { icons } from './icons.js';
import { toastError, toastSuccess } from './toast.js';
import { getProject, updateProject, addProject, removeProject, getState } from './state.js';
import { openLogPanel } from './logs.js';

function formatUptime(startedAt) {
  if (!startedAt) return '—';
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function openModal({ title, bodyHtml, actions, onOpen }) {
  const opener = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal__header">
        <span class="modal__title">${title}</span>
        <button class="btn btn--sm btn--icon" data-mact="close" title="Close">${icons.x}</button>
      </div>
      <div class="modal__body">${bodyHtml}</div>
      <div class="modal__footer"></div>
    </div>`;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    opener?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('[data-mact="close"]').addEventListener('click', close);

  const footer = backdrop.querySelector('.modal__footer');
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = `btn ${a.primary ? 'btn--primary' : ''} ${a.danger ? 'btn--danger' : ''}`;
    btn.textContent = a.label;
    btn.addEventListener('click', () => a.onClick({ backdrop, close, btn }));
    footer.appendChild(btn);
  }

  document.body.appendChild(backdrop);
  onOpen?.(backdrop);
  return { backdrop, close };
}

const field = (label, inner) => `
  <label class="field">
    <span class="field__label">${label}</span>
    ${inner}
  </label>`;

const input = (name, value = '', placeholder = '') =>
  `<input class="field__input" name="${name}" value="${value}" placeholder="${placeholder}" spellcheck="false">`;

function busy(btn, label) {
  btn.disabled = true;
  btn.innerHTML = `<span class="btn__spinner"></span> ${label}`;
}

function setError(backdrop, msg) {
  const el = backdrop.querySelector('.field__error');
  const inputEl = backdrop.querySelector('.field__input, .field__combobox, .field__select');
  if (el) el.textContent = msg ?? '';
  inputEl?.classList.toggle('field__input--error', Boolean(msg));
}

// Wire group select/input toggle — select always visible
function wireGroupPicker(backdrop) {
  const sel = backdrop.querySelector('[name$="-select"]');
  const inp = backdrop.querySelector('[name="group"]');
  if (!sel || !inp) return;
  const toggle = () => {
    inp.style.display = sel.value === '__new__' ? '' : 'none';
    if (sel.value === '__new__') inp.focus(); else inp.value = '';
  };
  sel.addEventListener('change', toggle);
  toggle();
}

// Get final group value from picker
function groupValue(backdrop) {
  const sel = backdrop.querySelector('[name$="-select"]');
  const inp = backdrop.querySelector('[name="group"]');
  if (sel.value === '__new__') return inp?.value.trim() || '';
  return sel.value;
}

// Group picker: select existing + text input for new group (select always visible)
function groupInput(name, value = '') {
  const groups = [...new Set(getState().projects.map(p => p.group).filter(Boolean))].sort();
  const opts = groups.map(g => `<option value="${g}" ${value === g ? 'selected' : ''}>${g}</option>`).join('');
  const isNew = value && !groups.includes(value);
  return `
    <select class="field__input field__select" name="${name}-select">
      <option value="">— Ungrouped —</option>
      ${opts}
      <option value="__new__" ${isNew ? 'selected' : ''}>+ New group…</option>
    </select>
    <input class="field__input field__input--group-new" name="${name}" value="${isNew ? value : ''}"
      placeholder="Type new group name…" spellcheck="false" style="${isNew ? '' : 'display:none'};margin-top:8px">`;
}

// ---------- Add Project ----------
export function openAddProjectDialog() {
  openModal({
    title: 'Add Project',
    bodyHtml:
      field('package.json path', input('path', '', 'D:/path/to/project/package.json')) +
      field('Package manager', input('pm', '', 'npm, yarn, pnpm, bun (auto-detected if empty)')) +
      field('Group (optional)', groupInput('group')) +
      '<span class="field__error"></span>',
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Scan & Add',
        primary: true,
        onClick: async ({ backdrop, close, btn }) => {
          const path = backdrop.querySelector('[name="path"]').value.trim();
          if (!path) return setError(backdrop, 'Path is required');
          const pm = backdrop.querySelector('[name="pm"]')?.value.trim() || '';
          const group = groupValue(backdrop);
          busy(btn, 'Scanning…');
          try {
            const project = await api.addProject(path, group || undefined, pm || undefined);
            addProject(project);
            toastSuccess(`Project "${project.name}" added`);
            close();
          } catch (err) {
            setError(backdrop, err.message);
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Scan & Add';
          }
        },
      },
    ],
    onOpen: (b) => { b.querySelector('[name="path"]').focus(); wireGroupPicker(b); },
  });
}

// ---------- Change Port ----------
export function openChangePortDialog(id, target) {
  const p = getProject(id);
  if (!p) return;

  const hasSub = p.subProjects?.length > 0;

  const bodyHtml = hasSub
    ? field('Target',
        `<select class="field__input field__select" name="port-target">
          <option value="">Root (${esc(p.name)})</option>
          ${p.subProjects.map(sp =>
            `<option value="${esc(sp.name)}" ${sp.name === target ? 'selected' : ''}>${esc(sp.name)} (port: ${sp.port ?? 'n/a'})</option>`
          ).join('')}
        </select>`) +
      field('New Port', input('port', '', 'e.g. 5180')) +
      '<span class="field__error"></span>'
    : field('Current Port', `<div class="field__value">${p.port ?? 'n/a'}</div>`) +
      field('New Port', input('port', '', 'e.g. 5180')) +
      '<span class="field__error"></span>';

  openModal({
    title: `Change Port — ${p.name}`,
    bodyHtml,
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Save',
        primary: true,
        onClick: async ({ backdrop, close, btn }) => {
          const raw = backdrop.querySelector('[name="port"]').value.trim();
          const port = Number(raw);
          if (!raw || !Number.isInteger(port) || port < 1 || port > 65535) {
            return setError(backdrop, 'Invalid port');
          }
          const targetSel = backdrop.querySelector('[name="port-target"]');
          const t = targetSel ? targetSel.value : undefined;
          busy(btn, 'Saving…');
          try {
            const updated = await api.changePort(id, port, t || undefined);
            updateProject(updated, { structural: false });
            toastSuccess(`Port updated to ${port}`);
            close();
          } catch (err) {
            setError(backdrop, err.message);
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Save';
          }
        },
      },
    ],
    onOpen: (b) => { const inp = b.querySelector('[name="port"]'); if (inp) inp.focus(); },
  });
}

// ---------- Edit Path ----------
export function openEditPathDialog(id) {
  const p = getProject(id);
  if (!p) return;
  openModal({
    title: `Edit Path — ${p.name}`,
    bodyHtml:
      field('package.json path', input('path', p.path)) +
      '<span class="field__error"></span>',
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Save & Rescan',
        primary: true,
        onClick: async ({ backdrop, close, btn }) => {
          const path = backdrop.querySelector('[name="path"]').value.trim();
          if (!path) return setError(backdrop, 'Path is required');
          busy(btn, 'Scanning…');
          try {
            const updated = await api.editPath(id, path);
            updateProject(updated, { structural: false });
            toastSuccess('Path updated');
            close();
          } catch (err) {
            setError(backdrop, err.message);
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Save & Rescan';
          }
        },
      },
    ],
    onOpen: (b) => b.querySelector('[name="path"]').focus(),
  });
}

// ---------- Move to Group ----------
export function openMoveGroupDialog(id) {
  const p = getProject(id);
  if (!p) return;
  openModal({
    title: `Move "${p.name}" to Group`,
    bodyHtml: field('Group name', groupInput('group', p.group || '')) + '<span class="field__error"></span>',
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Move',
        primary: true,
        onClick: async ({ backdrop, close, btn }) => {
          const group = groupValue(backdrop);
          busy(btn, 'Moving…');
          try {
            const updated = await api.editGroup(id, group || null);
            // Use structural:true so groups re-render in correct section
            updateProject(updated, { structural: true });
            toastSuccess(`Moved "${p.name}" to ${group || 'Ungrouped'}`);
            close();
          } catch (err) {
            setError(backdrop, err.message);
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Move';
          }
        },
      },
    ],
    onOpen: (b) => { b.querySelector('[name="group"]').focus(); wireGroupPicker(b); },
  });
}

// ---------- Rename Group ----------
export function openRenameGroupDialog(oldName) {
  if (oldName === 'Ungrouped') return;
  const examples = [...new Set(getState().projects.map(p => p.group).filter(Boolean))].filter(g => g !== oldName).sort();
  openModal({
    title: `Rename Group`,
    bodyHtml: field('Current name', `<div class="field__value">${oldName}</div>`) +
      field('New name', input('name', oldName, 'New group name')) +
      '<span class="field__error"></span>',
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Rename',
        primary: true,
        onClick: async ({ backdrop, close, btn }) => {
          const newName = backdrop.querySelector('[name="name"]').value.trim();
          if (!newName) return setError(backdrop, 'Name is required');
          if (newName === oldName) return setError(backdrop, 'Must be different from current name');
          if (examples.includes(newName)) return setError(backdrop, 'Group name already exists');
          busy(btn, 'Renaming…');
          try {
            await api.renameGroup(oldName, newName);
            toastSuccess(`Group renamed to "${newName}"`);
            close();
            const { setProjects } = await import('./state.js');
            setProjects(await api.getProjects());
          } catch (err) {
            setError(backdrop, err.message);
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Rename';
          }
        },
      },
    ],
    onOpen: (b) => {
      const inp = b.querySelector('[name="name"]');
      inp.focus();
      inp.select();
    },
  });
}

// ---------- Delete Group ----------
export function openDeleteGroupDialog(name) {
  if (name === 'Ungrouped') return;
  openModal({
    title: `Delete Group — ${name}`,
    bodyHtml: `<p>What should happen to projects in <strong>${name}</strong>?</p>`,
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Move to Ungrouped',
        onClick: async ({ close, btn }) => {
          busy(btn, 'Moving…');
          try {
            await api.deleteGroup(name, 'ungroup');
            toastSuccess(`Projects moved to Ungrouped`);
            close();
            const { setProjects } = await import('./state.js');
            setProjects(await api.getProjects());
          } catch (err) {
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Move to Ungrouped';
          }
        },
      },
      {
        label: 'Delete all projects',
        danger: true,
        onClick: async ({ close, btn }) => {
          busy(btn, 'Deleting…');
          try {
            await api.deleteGroup(name, 'delete_all');
            toastSuccess(`Group "${name}" and its projects deleted`);
            close();
            const { setProjects } = await import('./state.js');
            setProjects(await api.getProjects());
          } catch (err) {
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Delete all projects';
          }
        },
      },
    ],
  });
}
// ---------- Service Detail Modal ----------
export function openServiceDialog(id, script) {
  const p = getProject(id);
  if (!p) return;

  let timer = null;
  const { openModal } = {};

  const openModal2 = ({ title, bodyHtml, actions }) => {
    const opener = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal__header">
          <span class="modal__title">${title}</span>
          <button class="btn btn--sm btn--icon" data-mact="close" title="Close">${icons.x}</button>
        </div>
        <div class="modal__body">${bodyHtml}</div>
        <div class="modal__footer"></div>
      </div>`;

    const close = () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      opener?.focus?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('[data-mact="close"]').addEventListener('click', close);

    const footer = backdrop.querySelector('.modal__footer');
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${a.primary ? 'btn--primary' : ''} ${a.danger ? 'btn--danger' : ''}`;
      btn.textContent = a.label;
      btn.dataset.svcAction = a.key || '';
      btn.addEventListener('click', () => a.onClick({ backdrop, close, btn }));
      footer.appendChild(btn);
    }
    document.body.appendChild(backdrop);
    return { backdrop, close };
  };

  const serviceIsRunning = () => {
    const cur = getProject(id);
    return cur?.runningServices?.some((s) => s.script === script);
  };

  const getService = () => {
    const cur = getProject(id);
    return cur?.runningServices?.find((s) => s.script === script) || null;
  };

  const render = () => {
    const cur = getProject(id);
    if (!cur) return;
    const svc = getService();
    const body = backdrop?.querySelector('.modal__body');
    if (!body) return;
    body.innerHTML = `
      <dl class="card__meta">
        ${field('Status', `<span class="pill pill--${svc ? 'running' : 'stopped'}">${svc ? 'Running' : 'Stopped'}</span>`)}
        ${svc ? field('PID', `<div class="field__value">${svc.pid}</div>`) : ''}
        ${svc ? field('Uptime', `<div class="field__value">${formatUptime(svc.startedAt)}</div>`) : ''}
      </dl>`;
    const footer = backdrop?.querySelector('.modal__footer');
    if (!footer) return;
    const startBtn = footer.querySelector('[data-svc-action="start"]');
    const stopBtn = footer.querySelector('[data-svc-action="stop"]');
    if (startBtn) startBtn.disabled = !!svc;
    if (stopBtn) stopBtn.disabled = !svc;
  };

  let backdrop;
  const m = openModal2({
    title: `${script} — ${p.name}`,
    bodyHtml: '<div class="service-modal-body"></div>',
    actions: [
      {
        label: 'View Log',
        primary: true,
        key: 'log',
        onClick: ({ close }) => { close(); openLogPanel(id, script); },
      },
      {
        label: 'Start',
        key: 'start',
        onClick: async ({ close, btn }) => {
          btn.disabled = true;
          try { await api.startProject(id, script); toastSuccess(`${script} started`); }
          catch (err) { toastError(err.message); }
          btn.disabled = false;
        },
      },
      {
        label: 'Stop',
        danger: true,
        key: 'stop',
        onClick: async ({ close, btn }) => {
          btn.disabled = true;
          try { await api.stopProject(id, script); toastSuccess(`${script} stopped`); }
          catch (err) { toastError(err.message); }
          btn.disabled = false;
        },
      },
    ],
  });
  backdrop = m.backdrop;
  render();
  timer = setInterval(() => {
    const cur = getProject(id);
    if (cur) { render(); }
  }, 2000);
}

// ---------- Delete ----------
export function openDeleteDialog(id) {
  const p = getProject(id);
  if (!p) return;
  openModal({
    title: `Delete — ${p.name}`,
    bodyHtml: `<p>Remove <strong>${p.name}</strong> from the dashboard? The project folder on disk is not deleted.</p>`,
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: 'Delete',
        danger: true,
        onClick: async ({ close, btn }) => {
          busy(btn, 'Deleting…');
          try {
            await api.deleteProject(id);
            removeProject(id);
            toastSuccess(`Project "${p.name}" removed`);
            close();
          } catch (err) {
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = 'Delete';
          }
        },
      },
    ],
  });
}
