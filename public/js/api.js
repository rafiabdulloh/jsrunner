// REST client. USE_MOCK=true resolves everything from mock.js with fake
// latency; flip to false when the real backend lands (see brd.md contract).
import { mock } from './mock.js';

const USE_MOCK = false;
const BASE = '/api';

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const real = {
  getProjects: () => req('GET', '/projects'),
  getMetrics: async () => {
    // No dedicated endpoint yet; derive from the project list.
    const list = await req('GET', '/projects');
    return Object.fromEntries(list.map((p) => [p.id, { cpu: p.cpu, mem: p.mem }]));
  },
  addProject: (path, group, pm) => req('POST', '/project', { path, group, pm }),
  startProject: (id, script) => req('POST', '/project/start', { id, script }),
  stopProject: (id, script) => req('POST', '/project/stop', { id, script }),
  restartProject: (id) => req('POST', '/project/restart', { id }),
  runScript: (id, script) => req('POST', '/project/script', { id, script }),
  install: (id) => req('POST', '/project/script', { id, script: 'install' }),
  rescanProject: (id) => req('POST', '/project/rescan', { id }),
  // Endpoints not yet specified in the BRD; drop in the contract later.
  changePort: (id, port, target) => req('POST', '/project/port', { id, port, target }),
  editPath: (id, path) => req('POST', '/project/path', { id, path }),
  deleteProject: (id) => req('DELETE', `/project/${id}`),
  fetchLogs: (id, after = 0, script) => req('GET', `/project/${id}/logs?after=${after}${script ? `&script=${encodeURIComponent(script)}` : ''}`),
  clearLogs: (id) => req('POST', `/project/${id}/logs/clear`),
  cancelScript: (id) => req('POST', '/project/script/cancel', { id }),
  editGroup: (id, group) => req('POST', '/project/group', { id, group }),
  renameGroup: (oldName, newName) => req('POST', '/group/rename', { oldName, newName }),
  deleteGroup: (name, mode) => req('POST', '/group/delete', { name, mode }),
};

const call = (fn, ...args) => (USE_MOCK ? mock[fn](...args) : real[fn](...args));

export const api = {
  getProjects: () => call('getProjects'),
  getMetrics: () => call('getMetrics'),
  addProject: (path, group, pm) => call('addProject', path, group, pm),
  startProject: (id, script) => call('startProject', id, script),
  stopProject: (id, script) => call('stopProject', id, script),
  restartProject: (id) => call('restartProject', id),
  runScript: (id, script) => call('runScript', id, script),
  install: (id) => call('install', id),
  rescanProject: (id) => call('rescanProject', id),
  changePort: (id, port, target) => call('changePort', id, port, target),
  editPath: (id, path) => call('editPath', id, path),
  deleteProject: (id) => call('deleteProject', id),
  fetchLogs: (id, after, script) => call('fetchLogs', id, after, script),
  clearLogs: (id) => call('clearLogs', id),
  cancelScript: (id) => call('cancelScript', id),
  editGroup: (id, group) => call('editGroup', id, group),
  renameGroup: (oldName, newName) => call('renameGroup', oldName, newName),
  deleteGroup: (name, mode) => call('deleteGroup', name, mode),
};
