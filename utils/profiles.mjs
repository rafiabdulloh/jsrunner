// Profiles: named sets of projects that start together, across groups.
// Groups organise the dashboard; a profile is "what I need running right now".
// Kept in its own file so config/projects.json stays a plain project array.
import fs from 'fs';
import path from 'path';

const BASE = process.env.WORKDIR || process.cwd();
let _counter = 0;

export function getProfilesPath() {
  return path.join(BASE, 'config', 'profiles.json');
}

export function loadProfiles() {
  const file = getProfilesPath();
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt file — back up and start clean rather than crash on every request
    try {
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.bak`);
    } catch {
      // best effort
    }
    return [];
  }
}

export function saveProfiles(list) {
  const file = getProfilesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * All profiles, with references to deleted projects dropped.
 * @param {Set<string>|string[]} [knownProjectIds] - when given, prunes stale ids
 */
export function getProfiles(knownProjectIds) {
  const list = loadProfiles();
  if (!knownProjectIds) return list;

  const known = knownProjectIds instanceof Set ? knownProjectIds : new Set(knownProjectIds);
  let changed = false;

  for (const profile of list) {
    const kept = (profile.projectIds || []).filter((id) => known.has(id));
    if (kept.length !== (profile.projectIds || []).length) {
      profile.projectIds = kept;
      changed = true;
    }
  }

  if (changed) saveProfiles(list);
  return list;
}

export function getProfile(id) {
  return loadProfiles().find((p) => p.id === id);
}

export function addProfile(profile) {
  const list = loadProfiles();
  list.push(profile);
  saveProfiles(list);
  return profile;
}

export function updateProfile(id, patch) {
  const list = loadProfiles();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  list[idx] = { ...list[idx], ...patch };
  saveProfiles(list);
  return list[idx];
}

export function deleteProfile(id) {
  const list = loadProfiles();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveProfiles(list);
  return true;
}

/**
 * Drop a project from every profile — called when a project is deleted.
 */
export function removeProjectFromProfiles(projectId) {
  const list = loadProfiles();
  let changed = false;
  for (const profile of list) {
    const kept = (profile.projectIds || []).filter((id) => id !== projectId);
    if (kept.length !== (profile.projectIds || []).length) {
      profile.projectIds = kept;
      changed = true;
    }
  }
  if (changed) saveProfiles(list);
  return changed;
}

export function nextProfileId() {
  return `pf_${Date.now().toString(36)}_${_counter++}`;
}
