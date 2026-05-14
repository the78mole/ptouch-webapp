/**
 * i18n.js — Minimal internationalisation helper (zero dependencies)
 *
 * Supported HTML attributes:
 *   data-i18n="key"             → element.textContent
 *   data-i18n-html="key"        → element.innerHTML  (trusted static strings only)
 *   data-i18n-placeholder="key" → element.placeholder
 *   data-i18n-title="key"       → element.title
 *   data-i18n-aria="key"        → element.ariaLabel
 *
 * Usage:
 *   import { t, setLocale, getLocale, applyTranslations } from './i18n.js';
 *   applyTranslations();               // call once on startup
 *   document.addEventListener('localechange', () => updateDynamicText());
 */

// Tailwind safelist — classes only referenced inside translated HTML strings:
// text-blue-100 font-mono text-zinc-500

import en from "./locales/en.json";
import de from "./locales/de.json";

const LOCALES = { en, de };
const STORAGE_KEY = "ptouch-lang";
const FALLBACK = "en";

let _locale = localStorage.getItem(STORAGE_KEY) ?? FALLBACK;
if (!LOCALES[_locale]) _locale = FALLBACK;

// ─── Core API ────────────────────────────────────────────────────────────────

/** Resolve a dot-notation key (e.g. "header.connect") from a nested object. */
function resolve(obj, key) {
  return key.split(".").reduce((o, k) => o?.[k], obj);
}

/**
 * Translate a key. Optionally replace {{var}} placeholders.
 * Falls back to the English string, then to the raw key.
 *
 * @param {string}                  key
 * @param {Record<string, string>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  let str =
    resolve(LOCALES[_locale], key) ?? resolve(LOCALES[FALLBACK], key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return str;
}

/** Return the currently active locale code ('en' | 'de' | …). */
export function getLocale() {
  return _locale;
}

/**
 * Switch locale, persist the choice and refresh all translated DOM nodes.
 * Dispatches a 'localechange' CustomEvent so callers can update dynamic text.
 *
 * @param {string} lang  e.g. 'en' or 'de'
 */
export function setLocale(lang) {
  if (!LOCALES[lang] || lang === _locale) return;
  _locale = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyTranslations();
  document.dispatchEvent(
    new CustomEvent("localechange", { detail: { locale: lang } }),
  );
}

// ─── DOM walker ──────────────────────────────────────────────────────────────

/**
 * Update every DOM element that carries a data-i18n* attribute.
 * Safe to call multiple times (e.g. after dynamic content is inserted).
 */
export function applyTranslations() {
  document.documentElement.lang = _locale;

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  // innerHTML is used only for trusted, bundled translation strings — never for user input.
  for (const el of document.querySelectorAll("[data-i18n-html]")) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el).placeholder = t(
      el.dataset.i18nPlaceholder,
    );
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.ariaLabel = t(el.dataset.i18nAria);
  }
}
