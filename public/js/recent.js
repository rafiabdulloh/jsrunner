// Recent projects strip: horizontal chips, click to locate card, x to remove.
import { icons } from './icons.js';
import { getState, getProject, removeRecent } from './state.js';

export function renderRecent(strip) {
  const { recent } = getState();
  const list = strip.querySelector('.recent__list');
  list.replaceChildren();

  const projects = recent.map(getProject).filter(Boolean);
  strip.hidden = projects.length === 0;
  if (!projects.length) return;

  for (const p of projects) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `
      <span class="chip__dot ${p.status === 'running' ? 'chip__dot--running' : ''}"></span>
      <button class="chip__name"></button>
      <button class="chip__remove" title="Remove from recent" aria-label="Remove ${p.name} from recent">${icons.x}</button>`;
    const nameBtn = chip.querySelector('.chip__name');
    nameBtn.textContent = p.name;
    nameBtn.addEventListener('click', () => locateCard(p.id));
    chip.querySelector('.chip__remove').addEventListener('click', () => removeRecent(p.id));
    list.appendChild(chip);
  }
}

// Scroll to the card and flash it; expands its group if collapsed.
function locateCard(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('card--flash');
  requestAnimationFrame(() => card.classList.add('card--flash'));
}
