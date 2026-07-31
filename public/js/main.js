// Bootstrap: initial load, header actions, polling loops, event wiring.
import { api } from './api.js';
import { icons, logoIcon } from './icons.js';
import { on, getState, setProjects, updateProject } from './state.js';
import { renderGroups, startGroup, stopGroup, restartGroup } from './groups.js';
import { patchCard, startUptimeTicker } from './cards.js';
import { renderRecent } from './recent.js';
import { initSearch } from './search.js';
import { syncLogPanel } from './logs.js';
import { openAddProjectDialog } from './dialogs.js';
import { toastError, toastInfo } from './toast.js';

const main = document.querySelector('#groups');
const recentStrip = document.querySelector('#recent');

// Structural re-render on project list / search / collapse changes.
on('projects', () => {
  renderGroups(main);
  syncLogPanel();
});
on('project', (p) => patchCard(p));
on('recent', () => renderRecent(recentStrip));

// Crash / auto-restart notifications from the status poll.
on('status', ({ project, prev }) => {
  if (prev && prev.status === 'running' && project.status === 'crashed') {
    toastError(`${project.name} crashed`);
  }
  if (prev && prev.status === 'crashed' && project.status === 'running') {
    toastInfo(`${project.name} auto-restarted`);
  }
});

function wireHeader() {
  document.querySelector('#add-project').addEventListener('click', openAddProjectDialog);
  document.querySelector('#stop-all').addEventListener('click', () => stopGroup(getState().projects));
  initSearch(document.querySelector('#search'));
}

async function pollStatuses() {
  try {
    const list = await api.getProjects();
    const cur = getState().projects;
    const structural =
      list.length !== cur.length || list.some((p) => !cur.some((c) => c.id === p.id));
    if (structural) {
      setProjects(list);
    } else {
      // Patch in place: avoids a full re-render (and hover flicker) every 2s.
      for (const p of list) updateProject(p, { structural: false });
    }
  } catch (err) {
    toastError(err.message);
  }
}

async function boot() {
  wireHeader();
  startUptimeTicker(() => getState().projects);
  try {
    setProjects(await api.getProjects());
  } catch (err) {
    toastError(err.message);
  }
  renderRecent(recentStrip);
  setInterval(pollStatuses, 2000);
}

// Icons referenced in index.html static markup are injected here to keep
// the HTML free of duplicated SVG blobs.
document.querySelector('#logo').innerHTML = logoIcon;
document.querySelector('#add-project').insertAdjacentHTML('afterbegin', icons.plus);
document.querySelector('#stop-all').insertAdjacentHTML('afterbegin', icons.stop);

boot();
