/* Theme state — pure logic, no icon rendering (main.js handles icons). */

const STORAGE_KEY = 'jsrunner-theme';

export function currentTheme() {
  return document.documentElement.dataset.theme;
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const theme = saved ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const html = document.documentElement;
  // Temporary class animates every component's color change at once;
  // removed after the transition so per-element hover timings resume.
  html.classList.add('theme-transition');
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  html.dataset.theme = next;
  localStorage.setItem(STORAGE_KEY, next);
  setTimeout(() => html.classList.remove('theme-transition'), 250);
}
