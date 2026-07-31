// Realtime header search: filters cards by name/folder/port/framework/group.
import { setQuery } from './state.js';

export function initSearch(input) {
  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      setQuery('');
      input.blur();
    }
  });
}
