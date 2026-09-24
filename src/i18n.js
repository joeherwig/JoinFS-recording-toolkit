// Lazy-fetched locale strings, matching joinfs-gpx-to-jfs-webcomponent's pattern (locale JSON files
// fetched on demand rather than bundled). `t()` always has an `en` fallback available.

const cache = new Map();
let current = 'en';
let currentStrings = null;

function localeUrl(locale) {
  return new URL(`./locales/${locale}.json`, import.meta.url);
}

async function loadLocale(locale) {
  if (cache.has(locale)) return cache.get(locale);
  const promise = fetch(localeUrl(locale))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  cache.set(locale, promise);
  return promise;
}

export async function setLocale(locale) {
  const [en, strings] = await Promise.all([loadLocale('en'), locale === 'en' ? Promise.resolve({}) : loadLocale(locale)]);
  current = locale;
  currentStrings = { ...en, ...strings };
  return currentStrings;
}

/** Synchronous lookup once setLocale() has resolved at least once; falls back to the key itself. */
export function t(key, params) {
  let s = (currentStrings && currentStrings[key]) || key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function getLocale() {
  return current;
}

const KNOWN_LOCALES = ['en', 'de'];

/**
 * Locale resolution, matching joinfs-gpx-to-jfs-webcomponent's own `?lang=` URL parameter pattern
 * (see that component's `loadLocale()`) instead of an in-app dropdown - there's no interactive
 * switcher here; reload with `?lang=de` (etc.) to force a locale.
 */
export function resolveLocaleFromUrl() {
  try {
    const forced = new URLSearchParams(location.search).get('lang');
    if (forced && KNOWN_LOCALES.includes(forced)) return forced;
  } catch { /* location unavailable (non-browser test context) */ }
  for (const tag of (navigator.languages || [navigator.language || 'en'])) {
    const primary = tag.split('-')[0].toLowerCase();
    if (KNOWN_LOCALES.includes(primary)) return primary;
  }
  return 'en';
}
