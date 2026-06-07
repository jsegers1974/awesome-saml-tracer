// Shared rendering helpers for the SAML detail view.
// Pure ES module — string templating only, no DOMParser — so it runs anywhere
// the other shared modules do. Consumed by the devtools panel, the popup app
// window, and the drag-and-drop viewer so each rendering concern lives once.

/** HTML-escape a value for safe insertion into markup. */
export function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/** A definition-list row, or empty string when the value is missing. */
export function row(label, value) {
  if (value == null || value === '') return '';
  return `<dt>${escape(label)}</dt><dd>${escape(String(value))}</dd>`;
}

/** Last meaningful segment of a SAML attribute Name (after the final / # or :). */
export function shortName(name) {
  if (!name) return '';
  const m = name.match(/[/#:]([^/#:]+)$/);
  return m ? m[1] : name;
}

/** Truncate a string to n characters, with an ellipsis. */
export function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
