// Bootstrap: initial load, header actions, polling loops, event wiring.
import { api } from './api.js';
import { icons, logoIcon } from './icons.js';
import { on, getState, setProjects, updateProject } from './state.js';
import { renderGroups, startGroup, stopGroup, restartGroup } from './groups.js';
import { patchCard, startUptimeTicker } from './cards.js';
import { renderRecent } from './recent.js';
import { initProfiles, renderProfiles, refreshProfileCounts, loadProfiles } from './profiles.js';
import { initSearch } from './search.js';
import { syncLogPanel, notifyLogUpdate } from './logs.js';
import { openAddProjectDialog } from './dialogs.js';
import { toastError, toastInfo } from './toast.js';
import { connectEvents } from './events.js';

const main = document.querySelector('#groups');
const recentStrip = document.querySelector('#recent');
const profileStrip = document.querySelector('#profiles');

// Structural re-render on project list / search / collapse changes.
on('projects', () => {
  renderGroups(main);
  renderProfiles(); // running counts on the chips
  syncLogPanel();
});
on('project', (p) => {
  patchCard(p);
  refreshProfileCounts();
});
on('profiles', () => renderProfiles());
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

// Merge a fresh project list into the store, re-rendering structurally only
// when the set of cards actually changed (avoids hover flicker).
function applyProjects(list) {
  const cur = getState().projects;
  const structural =
    list.length !== cur.length || list.some((p) => !cur.some((c) => c.id === p.id));
  if (structural) {
    setProjects(list);
  } else {
    for (const p of list) updateProject(p, { structural: false });
  }
}

async function pollStatuses() {
  try {
    applyProjects(await api.getProjects());
  } catch (err) {
    toastError(err.message);
  }
}

function setLiveIndicator(state) {
  const el = document.querySelector('#live-status');
  if (!el) return;
  el.dataset.state = state;
  el.title = state === 'live'
    ? 'Live updates via server-sent events'
    : 'Event stream unavailable — falling back to polling every 2s';
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
  initProfiles(profileStrip);
  await loadProfiles();

  // Push instead of poll; the fallback ticker only runs if the stream drops.
  connectEvents({
    onProjects: applyProjects,
    onLogs: (batch) => notifyLogUpdate(batch.map((b) => b.id)),
    onFallbackTick: pollStatuses,
    onStatus: setLiveIndicator,
  });
}

// Icons referenced in index.html static markup are injected here to keep
// the HTML free of duplicated SVG blobs.
document.querySelector('#logo').innerHTML = logoIcon;
document.querySelector('#add-project').insertAdjacentHTML('afterbegin', icons.plus);
document.querySelector('#stop-all').insertAdjacentHTML('afterbegin', icons.stop);

boot();
