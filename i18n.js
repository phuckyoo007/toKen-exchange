// lib/i18n.js
// Lightweight, dependency-free i18n engine for the popup UI. Deliberately
// NOT chrome.i18n/_locales: the user picks a language from inside the
// wallet itself (a picker on the welcome screen, and another in Settings)
// rather than being stuck with whatever the browser's own UI language is,
// and the choice is remembered per-device in chrome.storage.local so it
// survives closing and reopening the popup.
//
// Each lib/i18n/<code>.js file (loaded before this one) registers itself
// into self.TM_I18N_DATA[code] with `strings` (flat dot-path keys used via
// data-i18n attributes and the t() helper below), `faq` (the Help &
// support chat's knowledge base, written natively in that language rather
// than machine-translated at runtime), and `greeting` /
// `fallbackWithEmail` / `fallbackNoEmail` for that same chat. English is
// the fallback for anything a language file is missing.
//
// A NOTE ON TRANSLATION QUALITY: these are AI-generated translations, not
// reviewed by native speakers of each language. They should be accurate
// enough to navigate the wallet and understand the FAQ answers, but given
// this is a financial product, a native-speaker review pass (especially of
// the security-critical wording around the recovery phrase and password
// reset) is worth doing before relying on it for real funds at scale.

const TM_I18N_LANGS = [
  { code: "en", name: "English" },
  { code: "ar", name: "العربية" },
  { code: "zh", name: "中文（简体）" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "pt", name: "Português" },
  { code: "ja", name: "日本語" },
  { code: "ru", name: "Русский" },
];

let tmI18nCurrentLang = "en";

function tmI18nData(lang) {
  const store = (typeof self !== "undefined" && self.TM_I18N_DATA) || {};
  return store[lang] || null;
}

function tmI18nEnData() {
  return tmI18nData("en") || { strings: {}, faq: [], greeting: "", fallbackWithEmail: "", fallbackNoEmail: "" };
}

function t(key, vars) {
  const data = tmI18nData(tmI18nCurrentLang) || tmI18nEnData();
  let str = (data.strings && data.strings[key]) || (tmI18nEnData().strings || {})[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.split(`{${k}}`).join(String(vars[k]));
    });
  }
  return str;
}

function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  const dir = tmI18nCurrentLang === "ar" ? "rtl" : "ltr";
  document.documentElement.setAttribute("lang", tmI18nCurrentLang);
  document.documentElement.setAttribute("dir", dir);
  document.querySelectorAll(".language-select").forEach((sel) => {
    sel.value = tmI18nCurrentLang;
  });
}

function getLanguage() {
  return tmI18nCurrentLang;
}

function supportedCodes() {
  return TM_I18N_LANGS.map((l) => l.code);
}

function detectDefaultLanguage() {
  const supported = supportedCodes();
  const browserLangs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  for (const bl of browserLangs) {
    const short = (bl || "").toLowerCase().split("-")[0];
    if (supported.includes(short)) return short;
  }
  return "en";
}

async function persistLanguage(code) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await new Promise((resolve) => chrome.storage.local.set({ tm_language: code }, resolve));
    }
  } catch (e) {
    // best-effort only -- worst case the picker just resets next time the popup opens
  }
}

function setLanguage(code, opts) {
  const supported = supportedCodes();
  tmI18nCurrentLang = supported.includes(code) ? code : "en";
  applyI18n(document);
  persistLanguage(tmI18nCurrentLang);
  if (!opts || !opts.silent) {
    document.dispatchEvent(new CustomEvent("tm-language-changed", { detail: { lang: tmI18nCurrentLang } }));
  }
}

async function initLanguage() {
  let stored = null;
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const res = await new Promise((resolve) => chrome.storage.local.get(["tm_language"], resolve));
      stored = res && res.tm_language;
    }
  } catch (e) {
    // fall through to browser-language detection below
  }
  const initial = supportedCodes().includes(stored) ? stored : detectDefaultLanguage();
  setLanguage(initial, { silent: true });
}

// ---- Help & support chat helpers (language-aware) ----
function getFaq() {
  const data = tmI18nData(tmI18nCurrentLang);
  return (data && data.faq && data.faq.length ? data.faq : tmI18nEnData().faq) || [];
}

function getChips() {
  return getFaq().map((entry) => ({ id: entry.id, chip: entry.chip }));
}

function scoreFaqEntry(entry, textLower) {
  let score = 0;
  for (const kw of entry.keywords) {
    if (textLower.includes(kw)) score += kw.split(" ").length;
  }
  return score;
}

function findBestAnswer(userText) {
  const textLower = (userText || "").toLowerCase().trim();
  if (!textLower) return null;
  let best = null;
  let bestScore = 0;
  for (const entry of getFaq()) {
    const score = scoreFaqEntry(entry, textLower);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

function findFaqById(id) {
  return getFaq().find((entry) => entry.id === id) || null;
}

function getGreeting() {
  const data = tmI18nData(tmI18nCurrentLang);
  return (data && data.greeting) || tmI18nEnData().greeting;
}

function getContactFallbackMessage() {
  const data = tmI18nData(tmI18nCurrentLang) || tmI18nEnData();
  const email = (typeof TM_SUPPORT_CONFIG !== "undefined" && TM_SUPPORT_CONFIG.SUPPORT_CONTACT_EMAIL) || "";
  const tmpl = email ? data.fallbackWithEmail || tmI18nEnData().fallbackWithEmail : data.fallbackNoEmail || tmI18nEnData().fallbackNoEmail;
  return tmpl.split("{email}").join(email);
}

function answerTextFor(entry) {
  if (!entry) return getContactFallbackMessage();
  if (entry.answer === "__CONTACT_FALLBACK__") return getContactFallbackMessage();
  return entry.answer;
}

if (typeof self !== "undefined") {
  self.TM_I18N = {
    LANGS: TM_I18N_LANGS,
    t,
    apply: applyI18n,
    getLanguage,
    setLanguage,
    initLanguage,
    detectDefaultLanguage,
    getFaq,
    getChips,
    findBestAnswer,
    findFaqById,
    getGreeting,
    getContactFallbackMessage,
    answerTextFor,
  };
}
