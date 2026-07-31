// Top-right toast notifications: success / error / info.
import { icons } from './icons.js';

const typeIcon = { success: icons.resume, error: icons.x, info: icons.terminal };

function ensureRoot() {
  let root = document.querySelector('.toasts');
  if (!root) {
    root = document.createElement('div');
    root.className = 'toasts';
    root.setAttribute('role', 'status');
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, type = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <span class="toast__icon">${typeIcon[type] ?? typeIcon.info}</span>
    <span class="toast__msg"></span>
    <button class="toast__close" aria-label="Dismiss">${icons.x}</button>`;
  el.querySelector('.toast__msg').textContent = message;

  const dismiss = () => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.toast__close').addEventListener('click', dismiss);

  ensureRoot().appendChild(el);
  setTimeout(dismiss, ms);
}

export const toastError = (m) => toast(m, 'error');
export const toastSuccess = (m) => toast(m, 'success');
export const toastInfo = (m) => toast(m, 'info');
