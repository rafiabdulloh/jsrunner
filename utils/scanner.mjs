import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';

/**
 * Detect framework from dependencies/devDependencies.
 * Priority order: first match wins (most specific first).
 */
export function detectFramework(deps, devDeps) {
  const all = { ...deps, ...devDeps };
  const has = (name) => name in all;

  // Most specific frameworks first
  if (has('next')) return 'Next';
  if (has('@angular/core')) return 'Angular';
  if (has('nuxt')) return 'Nuxt';
  if (has('vue')) return 'Vue';
  if (has('@nestjs/core')) return 'NestJS';
  if (has('astro')) return 'Astro';
  if (has('react')) return 'React';
  if (has('vite')) return 'Vite';
  if (has('express')) return 'Express';

  // Generic Node if any deps exist
  if (deps && Object.keys(deps).length > 0) return 'Node';
  if (devDeps && Object.keys(devDeps).length > 0) return 'Node';

  return 'Unknown';
}

/**
 * Detect package manager by checking lock files in priority order.
 * Falls back to 'npm' when none found.
 */
export function detectPackageManager(folderPath) {
  const checks = [
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];

  for (const [file, pm] of checks) {
    try {
      if (existsSync(join(folderPath, file))) {
        return pm;
      }
    } catch {
      // skip unreadable files, try next
    }
  }

  return 'npm';
}

/**
 * Detect port from project config files in priority order.
 * Returns first port found as number, or null.
 */
export function detectPort(folderPath, pkg) {
  // .env files — read only
  for (const file of ['.env', '.env.local', '.env.development']) {
    try {
      const p = join(folderPath, file);
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf-8');
        const m = content.match(/^PORT\s*=\s*(\d+)/m);
        if (m) return parseInt(m[1], 10);
      }
    } catch {
      // skip unreadable
    }
  }

  // vite.config
  for (const file of ['vite.config.js', 'vite.config.ts']) {
    try {
      const p = join(folderPath, file);
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf-8');
        const m = content.match(/port\s*:\s*(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    } catch { /* skip */ }
  }

  // next.config
  for (const file of ['next.config.js', 'next.config.mjs']) {
    try {
      const p = join(folderPath, file);
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf-8');
        const m = content.match(/port\s*:\s*(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    } catch { /* skip */ }
  }

  // package.json scripts
  try {
    if (pkg && pkg.scripts) {
      for (const script of Object.values(pkg.scripts)) {
        const m = script.match(/--port\s+(\d+)/) || script.match(/-p\s+(\d+)/) || script.match(/\bPORT=(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    }
  } catch { /* skip */ }

  // angular.json
  try {
    const p = join(folderPath, 'angular.json');
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      const m = content.match(/"port"\s*:\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
  } catch { /* skip */ }

  // nest-cli.json
  try {
    const p = join(folderPath, 'nest-cli.json');
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      const m = content.match(/"port"\s*:\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
  } catch { /* skip */ }

  return null;
}

/**
 * Detect sub-projects from workspaces + dev:x / start:x scripts.
 * Skips start:dev to avoid false-positive "dev" sub-project.
 * @param {object} rootPkg - Parsed root package.json
 * @param {string} [rootFolder=process.cwd()] - Root folder for resolving paths
 * @returns {Array<{name: string, path: string, port: number|null}>}
 */
export function detectSubProjects(rootPkg, rootFolder = process.cwd()) {
  const workspaces = rootPkg.workspaces;
  if (!Array.isArray(workspaces) || workspaces.length === 0) return [];

  const results = [];
  const seen = new Set();

  // Resolve workspace patterns
  for (const pattern of workspaces) {
    let folders = [];

    if (pattern.includes('*')) {
      // Glob: list entries in base directory
      const starIdx = pattern.indexOf('*');
      const base = pattern.slice(0, starIdx);
      const baseDir = resolve(rootFolder, base);
      try {
        const entries = readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (!entry.isDirectory()) continue;
          folders.push(join(baseDir, entry.name));
        }
      } catch {
        // folder missing, skip
      }
    } else {
      // Literal path
      const folder = resolve(rootFolder, pattern);
      if (existsSync(folder)) {
        folders.push(folder);
      }
    }

    for (const folder of folders) {
      const pkgPath = join(folder, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const name = basename(folder);
      if (seen.has(name)) continue;
      seen.add(name);
      let pkg;
      try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch { pkg = {}; }
      const port = detectPort(folder, pkg);
      results.push({ name, path: pkgPath, port });
    }
  }

  // Detect from dev:<name> / start:<name> scripts
  if (rootPkg.scripts) {
    for (const script of Object.keys(rootPkg.scripts)) {
      const m = script.match(/^(dev|start):(.+)$/);
      if (!m) continue;
      const name = m[2];
      if (name === 'dev') continue; // skip start:dev
      if (seen.has(name)) continue;

      const folder = resolve(rootFolder, name);
      const pkgPath = join(folder, 'package.json');
      if (!existsSync(pkgPath)) continue;
      seen.add(name);
      let pkg;
      try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch { pkg = {}; }
      const port = detectPort(folder, pkg);
      results.push({ name, path: pkgPath, port });
    }
  }

  return results;
}

/**
 * Scan a project folder and return all metadata from package.json.
 */
export function scanProject(folderPath) {
  const pkgPath = join(folderPath, 'package.json');

  if (!existsSync(pkgPath)) {
    throw new Error('Package.json not found');
  }

  let pkg;
  try {
    const raw = readFileSync(pkgPath, 'utf-8');
    pkg = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('Invalid package.json');
    }
    throw err;
  }

  const name = pkg.name || basename(folderPath);
  const version = pkg.version || null;
  const scripts = pkg.scripts ? Object.keys(pkg.scripts).sort() : [];
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  const framework = detectFramework(deps, devDeps);
  const pm = detectPackageManager(folderPath);
  const port = detectPort(folderPath, pkg);

  return {
    name,
    version,
    scripts,
    framework,
    pm,
    port,
    folder: folderPath,
    path: pkgPath,
    dependencies: deps,
    devDependencies: devDeps,
  };
}

/**
 * Convenience wrapper — re-runs scanProject (stateless).
 */
export function rescan(folderPath) {
  return scanProject(folderPath);
}
