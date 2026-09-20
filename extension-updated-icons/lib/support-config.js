// lib/support-config.js
// Contact info shown by the Help & support chat when its FAQ knowledge base
// (lib/i18n/<code>.js's `faq` list) doesn't have a matching answer, or when
// someone explicitly asks for a human. The actual fallback message (in
// whichever language is currently selected) is built by
// TM_I18N.getContactFallbackMessage() in lib/i18n.js -- this file only
// holds the one thing a developer might want to change.
//
// Fill in a real address you monitor. Until you do, the chat is honest
// about not having a live support line yet instead of showing a broken
// mailto: link, in every supported language.
const SUPPORT_CONTACT_EMAIL = ""; // e.g. "support@yourdomain.com"

if (typeof self !== "undefined") {
  self.TM_SUPPORT_CONFIG = { SUPPORT_CONTACT_EMAIL };
}
