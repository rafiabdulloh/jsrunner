// Group sections: collapsible, counts, group-scoped actions, card grid.
import { api } from './api.js';
import { icons } from './icons.js';
import { toastError, toastSuccess } from './toast.js';
import { renderCard } from './cards.js';
import { getState, matchesQuery, toggleCollapsed, updateProject, patchProject, addRecent, setProjects } from './state.js';
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
  const targets = list.filter((p) =>
    verb === 'start' ? p.status !== 'running' && p.status !== 'starting' : p.status !== 'stopped'
  );
  if (!targets.length) return;
  for (const p of targets) patchProject(p.id, { status: 'starting' }, { structural: false });
  const results = await Promise.allSettled(targets.map((p) => action(p.id)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      updateProject(r.value, { structural: false });
      if (verb !== 'stop') addRecent(targets[i].id);
    } else if (r.status === 'rejected') {
      patchProject(targets[i].id, { status: 'stopped' }, { structural: false });
      toastError(`${targets[i].name}: ${r.reason.message}`);
    }
  });
}

export const startGroup = (list) => bulkAction(list, api.startProject, 'start');
export const stopGroup = (list) => bulkAction(list, api.stopProject, 'stop');
export const restartGroup = (list) => bulkAction(list, api.restartProject, 'restart');

function renderGroup(name, projects, collapsed) {
  const section = document.createElement('section');
  section.className = `group${collapsed ? ' group--collapsed' : ''}`;
  section.dataset.group = name;

  const runningCount = projects.filter((p) => p.status === 'running').length;
  const header = document.createElement('div');
  header.className = 'group__header';
  header.innerHTML = `
    <button class="group__toggle" aria-expanded="${!collapsed}">
      <span class="group__chevron">${icons.chevron}</span>
      <span class="group__name">${name}</span>
    </button>
    <button class="btn btn--sm btn--icon" data-gact="rename" title="Rename group">${icons.edit}</button>
    <span class="group__count">${projects.length}</span>
    ${runningCount ? `<span class="group__count group__count--running">${runningCount} running</span>` : ''}
    <div class="group__actions">
      <button class="btn btn--sm btn--icon" data-gact="stop" title="Stop all in ${name}">${icons.stop}</button>
      <button class="btn btn--sm btn--icon btn--danger" data-gact="delete" title="Delete group">${icons.trash}</button>
    </div>`;
  header.querySelector('.group__toggle').addEventListener('click', () => toggleCollapsed(name));
  header.querySelector('[data-gact="stop"]').addEventListener('click', () => stopGroup(projects));
  header.querySelector('[data-gact="rename"]').addEventListener('click', () => openRenameGroupDialog(name));
  header.querySelector('[data-gact="delete"]').addEventListener('click', () => openDeleteGroupDialog(name));

  const body = document.createElement('div');
  body.className = 'group__body';
  for (const p of [...projects].sort(byName)) body.appendChild(renderCard(p));

  section.append(header, body);
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
  const { projects, collapsed, query } = getState();
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
    container.appendChild(renderGroup(name, list, collapsed[name] ?? false));
  }
}
