// App-chrome theme: 'auto' | 'light' | 'dark'. Independent of <jfs-map>'s tile theme (which has no
// 'auto' mode and is about tile-layer choice only - see PLAN.md Step 4/1b).

const STORAGE_KEY = 'jfs-toolkit:appTheme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolve(theme) {
  if (theme === 'auto') return media && media.matches ? 'dark' : 'light';
  return theme;
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', resolve(theme));
}

export function getStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || 'auto'; } catch { return 'auto'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore (private browsing etc.) */ }
  apply(theme);
}

export function initTheme() {
  const theme = getStoredTheme();
  apply(theme);
  if (media) {
    media.addEventListener('change', () => {
      if (getStoredTheme() === 'auto') apply('auto');
    });
  }
  return theme;
}
