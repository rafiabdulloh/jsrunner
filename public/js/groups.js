// Group sections: collapsible, counts, group-scoped actions, card grid.
import { api } from './api.js';
import { icons } from './icons.js';
import { toastError, toastSuccess } from './toast.js';
import { renderCard } from './cards.js';
import { getState, matchesQuery, toggleCollapsed, toggleView, updateProject, patchProject, addRecent, setProjects } from './state.js';
import { openRenameGroupDialog, openDeleteGroupDialog } from './dialogs.js';

const UNGROUPED = 'Ungrouped';

function groupProjects(projects) {
  const map = new Map();
  for (const p of projects) {
    const key = p.group || UNGROUPED;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  // Named groups first (alphabetical), Ungrouped last.
  return [...map.entries()].sort(([a], [b]) =>
    a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)
  );
}

const byName = (a, b) => a.name.localeCompare(b.name);

async function bulkAction(list, action, verb) {
  const targets = list.filter((p) => {
    if (verb === 'start') return p.status !== 'running' && p.status !== 'starting';
    if (verb === 'stop') return (p.runningServices?.length || 0) > 0;
    return p.status !== 'stopped'; // restart
  });
  if (!targets.length) return;
  if (verb !== 'stop') for (const p of targets) patchProject(p.id, { status: 'starting' }, { structural: false });
  const results = await Promise.allSettled(targets.map((p) => action(p.id)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      updateProject(r.value, { structural: false });
      if (verb !== 'stop') addRecent(targets[i].id);
    } else if (r.status === 'rejected') {
      if (verb !== 'stop') patchProject(targets[i].id, { status: 'stopped' }, { structural: false });
      toastError(`${targets[i].name}: ${r.reason.message}`);
    }
  });
  if (verb === 'stop') setProjects(await api.getProjects());
}

export const startGroup = (list) => bulkAction(list, api.startProject, 'start');
export const stopGroup = (list) => bulkAction(list, api.stopProject, 'stop');
export const restartGroup = (list) => bulkAction(list, api.restartProject, 'restart');

// Kanban lanes. Crashed only earns a column when something actually crashed.
const LANES = [
  { key: 'stopped', title: 'Stopped', match: (p) => p.status === 'stopped', always: true },
  { key: 'starting', title: 'In Progress', match: (p) => p.status === 'starting', always: true },
  { key: 'running', title: 'Running', match: (p) => p.status === 'running', always: true },
  { key: 'crashed', title: 'Crashed', match: (p) => p.status === 'crashed', always: false },
];

function kanbanBody(projects) {
  const body = document.createElement('div');
  body.className = 'group__body group__body--kanban';
  const sorted = [...projects].sort(byName);

  for (const lane of LANES) {
    const list = sorted.filter(lane.match);
    if (!list.length && !lane.always) continue;

    const column = document.createElement('div');
    column.className = 'column';
    column.dataset.lane = lane.key;
    column.innerHTML = `
      <div class="column__title">${lane.title}<span class="column__count">${list.length}</span></div>
      <div class="column__cards"></div>`;
    const cards = column.querySelector('.column__cards');
    if (list.length) for (const p of list) cards.appendChild(renderCard(p));
    else cards.innerHTML = '<div class="column__empty">Nothing here</div>';
    body.appendChild(column);
  }
  return body;
}

function listBody(projects) {
  const body = document.createElement('div');
  body.className = 'group__body';
  for (const p of [...projects].sort(byName)) body.appendChild(renderCard(p));
  return body;
}

function renderGroup(name, projects, collapsed, view) {
  const section = document.createElement('section');
  section.className = `group${collapsed ? ' group--collapsed' : ''}`;
  section.dataset.group = name;

  const runningCount = projects.filter((p) => p.status === 'running').length;
  const pct = projects.length ? Math.round((runningCount / projects.length) * 100) : 0;
  const kanban = view === 'kanban';

  const header = document.createElement('div');
  header.className = 'group__header';
  header.innerHTML = `
    <button class="group__toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${name}">
      <span class="group__chevron">${icons.chevron}</span>
    </button>
    <span class="group__name">${name}</span>
    ${name !== UNGROUPED ? `<button class="btn btn--icon" data-gact="rename" title="Rename group">${icons.edit}</button>` : ''}
    <span class="group__count">${projects.length}</span>
    ${runningCount ? `<span class="group__count group__count--running">${runningCount} running</span>` : ''}
    <div class="group__progress" title="${runningCount} of ${projects.length} running">
      <div class="group__progress-bar" style="width:${pct}%"></div>
    </div>
    <span class="group__spacer"></span>
    <div class="group__actions">
      <button class="btn btn--icon ${kanban ? 'btn--active' : ''}" data-gact="view"
        title="${kanban ? 'Switch to grid view' : 'Switch to status columns'}"
        aria-pressed="${kanban ? 'true' : 'false'}">${icons.columns}</button>
      <button class="btn btn--icon" data-gact="stop" title="Stop all in ${name}">${icons.stop}</button>
      ${name !== UNGROUPED ? `<button class="btn btn--icon btn--danger" data-gact="delete" title="Delete group">${icons.trash}</button>` : ''}
    </div>`;
  header.querySelector('.group__toggle').addEventListener('click', () => toggleCollapsed(name));
  header.querySelector('.group__name').addEventListener('click', () => toggleCollapsed(name));
  header.querySelector('[data-gact="view"]').addEventListener('click', () => toggleView());
  header.querySelector('[data-gact="stop"]').addEventListener('click', () => stopGroup(projects));
  header.querySelector('[data-gact="rename"]')?.addEventListener('click', () => openRenameGroupDialog(name));
  header.querySelector('[data-gact="delete"]')?.addEventListener('click', () => openDeleteGroupDialog(name));

  section.append(header);
  if (collapsed) {
    const note = document.createElement('div');
    note.className = 'group__collapsed-note';
    note.textContent = 'Group collapsed';
    section.append(note);
  } else {
    section.append(kanban ? kanbanBody(projects) : listBody(projects));
  }
  return section;
}

function emptyState(title, detail) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML = `${icons.box}
    <div class="empty__title"></div>
    <p></p>`;
  div.querySelector('.empty__title').textContent = title;
  div.querySelector('p').textContent = detail;
  return div;
}

// Full re-render of the main area on structural changes / search.
export function renderGroups(container) {
  const { projects, collapsed, query, view } = getState();
  container.replaceChildren();

  if (!projects.length) {
    container.appendChild(
      emptyState('No projects yet', 'Click Add Project and point to a folder or workspace — every service inside is detected automatically.')
    );
    return;
  }

  const visible = projects.filter(matchesQuery);
  if (!visible.length) {
    container.appendChild(emptyState('No matches', `No projects match "${query}".`));
    return;
  }

  for (const [name, list] of groupProjects(visible)) {
    container.appendChild(renderGroup(name, list, collapsed[name] ?? false, view));
  }
}
