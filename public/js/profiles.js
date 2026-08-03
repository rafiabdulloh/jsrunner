// Profile strip: one-click start/stop for a named set of projects across groups.
import { api } from './api.js';
import { icons } from './icons.js';
import { getState, setProfiles, updateProject, patchProject } from './state.js';
import { toastError, toastSuccess, toastInfo } from './toast.js';
import { openProfileDialog, openDeleteProfileDialog } from './dialogs.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let container = null;

export async function loadProfiles() {
  try {
    setProfiles(await api.getProfiles());
  } catch (err) {
    toastError(err.message);
  }
}

/**
 * How many of a profile's projects are actually serving — same definition the
 * card uses, so the chip never claims "3/3" while cards still say "Starting".
 */
function runningCount(profile) {
  const { projects } = getState();
  return (profile.projectIds || []).filter((id) => {
    const p = projects.find((x) => x.id === id);
    if (!p || p.status !== 'running') return false;
    return !p.port || p.health !== 'waiting';
  }).length;
}

function chip(profile) {
  const total = profile.projectIds?.length || 0;
  const up = runningCount(profile);
  const allUp = total > 0 && up === total;

  const sequential = profile.mode === 'sequential';

  const el = document.createElement('div');
  el.className = `profile${up > 0 ? ' profile--active' : ''}`;
  el.dataset.id = profile.id;
  if (profile.color) el.style.setProperty('--profile-color', profile.color);
  el.innerHTML = `
    <button class="profile__run" data-pact="${allUp ? 'stop' : 'start'}"
      title="${allUp ? 'Stop' : 'Start'} ${esc(profile.name)} — ${total} project${total === 1 ? '' : 's'}, ${sequential ? 'one at a time in order' : 'all at once'}">
      ${allUp ? icons.stop : icons.play}
      <span class="profile__name">${esc(profile.name)}</span>
      ${sequential ? '<span class="profile__mode" title="Sequential start">seq</span>' : ''}
      <span class="profile__count">${up}/${total}</span>
    </button>
    <button class="profile__edit btn--icon" data-pact="edit" title="Edit profile">${icons.edit}</button>
    <button class="profile__edit btn--icon" data-pact="delete" title="Delete profile">${icons.x}</button>`;
  return el;
}

async function startProfile(profile) {
  const ids = profile.projectIds || [];
  // Sequential mode only starts the first one now — do not claim the rest are
  // starting when they are genuinely still queued.
  const optimistic = profile.mode === 'sequential' ? ids.slice(0, 1) : ids;
  for (const id of optimistic) {
    const p = getState().projects.find((x) => x.id === id);
    if (p && p.status !== 'running') patchProject(id, { status: 'starting' }, { structural: false });
  }
  try {
    const res = await api.startProfile(profile.id);
    toastInfo(
      res.mode === 'sequential'
        ? `Starting ${profile.name} — ${res.starting} project${res.starting === 1 ? '' : 's'}, one at a time`
        : `Starting ${profile.name} — ${res.starting} project${res.starting === 1 ? '' : 's'}`
    );
  } catch (err) {
    toastError(err.message);
    for (const id of optimistic) patchProject(id, { status: 'stopped' }, { structural: false });
  }
}

async function stopProfile(profile) {
  try {
    const res = await api.stopProfile(profile.id);
    toastSuccess(`Stopped ${res.stopped} project${res.stopped === 1 ? '' : 's'} in ${profile.name}`);
    // The stop already happened server-side; refresh from the source of truth
    const list = await api.getProjects();
    for (const p of list) updateProject(p, { structural: false });
  } catch (err) {
    toastError(err.message);
  }
}

/**
 * Update counts and the run/stop toggle in place. Called on every project
 * patch (twice a second with several services up), so it must not rebuild
 * the DOM — that would flicker and swallow clicks.
 */
export function refreshProfileCounts() {
  if (!container) return;
  for (const profile of getState().profiles) {
    const el = container.querySelector(`.profile[data-id="${profile.id}"]`);
    if (!el) continue;

    const total = profile.projectIds?.length || 0;
    const up = runningCount(profile);
    const allUp = total > 0 && up === total;

    const countEl = el.querySelector('.profile__count');
    const next = `${up}/${total}`;
    if (countEl.textContent !== next) countEl.textContent = next;
    el.classList.toggle('profile--active', up > 0);

    const runBtn = el.querySelector('.profile__run');
    const wanted = allUp ? 'stop' : 'start';
    if (runBtn.dataset.pact !== wanted) {
      runBtn.dataset.pact = wanted;
      runBtn.title = `${allUp ? 'Stop' : 'Start'} ${profile.name} (${total} project${total === 1 ? '' : 's'})`;
      runBtn.querySelector('svg')?.replaceWith(
        new DOMParser().parseFromString(allUp ? icons.stop : icons.play, 'text/html').body.firstChild
      );
    }
  }
}

export function renderProfiles(el) {
  container = el || container;
  if (!container) return;

  const { profiles } = getState();
  container.replaceChildren();

  const label = document.createElement('span');
  label.className = 'profiles__label';
  label.textContent = 'Profiles';
  container.appendChild(label);

  for (const profile of profiles) container.appendChild(chip(profile));

  const add = document.createElement('button');
  add.className = 'btn btn--sm profiles__add';
  add.innerHTML = `${icons.plus} New profile`;
  add.addEventListener('click', () => openProfileDialog());
  container.appendChild(add);

  if (profiles.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'profiles__hint';
    hint.textContent = 'Group projects you always start together — across groups.';
    container.appendChild(hint);
  }

  container.hidden = false;
}

export function initProfiles(el) {
  container = el;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const chipEl = btn.closest('.profile');
    if (!chipEl) return;

    const profile = getState().profiles.find((p) => p.id === chipEl.dataset.id);
    if (!profile) return;

    switch (btn.dataset.pact) {
      case 'start':
        startProfile(profile);
        break;
      case 'stop':
        stopProfile(profile);
        break;
      case 'edit':
        openProfileDialog(profile);
        break;
      case 'delete':
        openDeleteProfileDialog(profile);
        break;
    }
  });
}
