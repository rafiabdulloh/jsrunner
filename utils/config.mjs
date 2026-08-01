import fs from 'fs';
import path from 'path';

const BASE = process.env.WORKDIR || process.cwd();
let base = BASE;
let _counter = 0;

/** Override the config root (called by server.mjs with the --workdir CLI value). */
export function setBase(dir) {
  base = dir;
}

// Predefined harmonious hues for backfill
const HUES = [210, 160, 30, 340, 190, 280, 15, 50, 100, 260, 330, 40, 170, 300, 80];
let _hueIdx = 0;

function nextColor() {
  return `hsl(${HUES[_hueIdx++ % HUES.length]}, 60%, 50%)`;
}

export function getConfigPath() {
  return path.join(base, 'config', 'projects.json');
}

export function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      saveConfig([]);
      return [];
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Corrupt file — back up and reset
    try {
      const bakPath = configPath + '.bak';
      if (fs.existsSync(configPath)) {
        fs.renameSync(configPath, bakPath);
      }
    } catch {
      // best-effort backup
    }
    saveConfig([]);
    return [];
  }
}

export function saveConfig(data) {
  const configPath = getConfigPath();
  // Fresh installs ship without the config/ dir — create it on first write.
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, configPath);
}

export function getProjects() {
  const list = loadConfig();
  let changed = false;
  for (const p of list) {
    if (!p.color) {
      p.color = nextColor();
      changed = true;
    }
  }
  if (changed) saveConfig(list);
  return list;
}

export function getProject(id) {
  const projects = loadConfig();
  return projects.find(p => p.id === id);
}

export function addProject(project) {
  const projects = loadConfig();
  projects.push(project);
  saveConfig(projects);
  return project;
}

export function updateProject(id, patch) {
  const projects = loadConfig();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return undefined;
  projects[idx] = { ...projects[idx], ...patch };
  saveConfig(projects);
  return projects[idx];
}

export function deleteProject(id) {
  const projects = loadConfig();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  saveConfig(projects);
  return true;
}

export function nextId() {
  return `p_${Date.now().toString(36)}_${_counter++}`;
}
