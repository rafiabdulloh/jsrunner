// Builds a config entry from a scanned folder. Shared by single Add Project
// and bulk workspace add so both produce identical shapes.
import fs from 'fs';
import path from 'path';
import * as config from './config.mjs';
import * as scanner from './scanner.mjs';

// Golden-angle hue steps keep bulk-added projects visually distinct.
const HUE_STEP = 137;

export function pickColor(index = 0) {
  const base = Math.floor(Math.random() * 360);
  const hue = (base + index * HUE_STEP) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

/**
 * Accepts either a folder or a .../package.json path and returns the folder.
 */
export function toFolder(inputPath) {
  const normalized = String(inputPath).replace(/\\/g, '/').replace(/\/+$/, '');
  return path.basename(normalized) === 'package.json' ? path.dirname(normalized) : normalized;
}

/**
 * Scan a folder and return a ready-to-store project object (not saved yet).
 * @throws {Error} when package.json is missing or invalid
 */
export function buildProject(folderPath, { group = null, pm, color, index = 0 } = {}) {
  const pkgPath = path.join(folderPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('Package.json not found');
  }

  const meta = scanner.scanProject(folderPath);

  let subProjects = [];
  try {
    const rawPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    subProjects = scanner.detectSubProjects(rawPkg, folderPath);
  } catch {
    // already validated by scanProject; sub-projects are best-effort
  }

  return {
    id: config.nextId(),
    name: meta.name,
    group: group || null,
    framework: meta.framework,
    pm: pm || meta.pm,
    folder: meta.folder,
    path: meta.path,
    port: meta.port,
    scripts: meta.scripts,
    subProjects,
    color: color || pickColor(index),
    status: 'stopped',
    pid: null,
    startedAt: null,
  };
}

/**
 * True when a project with the same package.json path is already in config.
 */
export function isDuplicate(pkgPath, projects, exceptId) {
  const target = pkgPath.replace(/\\/g, '/');
  return projects.some(
    (p) => p.id !== exceptId && String(p.path).replace(/\\/g, '/') === target
  );
}
