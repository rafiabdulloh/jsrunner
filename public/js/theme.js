// Dark / light theme: one attribute on <html>, remembered across sessions.
// index.html sets the initial value inline before paint; this module only owns
// the toggle and keeps the button's pressed state in sync.
const KEY = 'lsr.theme';

const read = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function apply(theme, btn) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — the theme still applies for this session */
  }
  if (btn) {
    btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
}

export function initTheme(btn) {
  apply(read(), btn);
  btn?.addEventListener('click', () => apply(read() === 'dark' ? 'light' : 'dark', btn));
}
