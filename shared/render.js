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

/**
 * The Attributes section of a SAML summary.
 * Surfaces an encryption notice when the assertion or individual attributes
 * are encrypted; otherwise renders the friendly/name/value table.
 */
export function renderAttributes(s) {
  const attrs = s.attributes || [];
  if (s.assertionEncrypted) {
    return '<p class="empty">Assertion is encrypted — attributes cannot be decoded without the SP&#39;s private key.</p>';
  }
  if (s.encryptedAttributeCount && !attrs.length) {
    return `<p class="empty">${s.encryptedAttributeCount} attribute${s.encryptedAttributeCount === 1 ? '' : 's'} are individually encrypted — cannot be decoded without the SP&#39;s private key.</p>`;
  }
  if (!attrs.length) return '<p class="empty">No SAML attributes in this message.</p>';
  const rows = attrs.map(a => `
    <tr>
      <td><code>${escape(a.friendlyName || shortName(a.name))}</code></td>
      <td><code class="muted">${escape(a.name || '')}</code></td>
      <td>${a.values.length
        ? a.values.map(v => `<div>${escape(v)}</div>`).join('')
        : '<span class="muted">(no values)</span>'}</td>
    </tr>`).join('');
  const encNote = s.encryptedAttributeCount
    ? `<p class="empty" style="margin-top:8px;">${s.encryptedAttributeCount} additional attribute${s.encryptedAttributeCount === 1 ? '' : 's'} are encrypted and not shown.</p>`
    : '';
  return `
    <h3 style="margin-top:16px;">Attributes (${attrs.length})</h3>
    <table class="attrs">
      <thead><tr><th>Friendly</th><th>Name</th><th>Value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${encNote}`;
}
