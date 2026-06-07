// Shared rendering helpers for the SAML detail view.
// Pure ES module — string templating only, no DOMParser — so it runs anywhere
// the other shared modules do. Consumed by the devtools panel, the popup app
// window, and the drag-and-drop viewer so each rendering concern lives once.

import { prettyPrintXml } from './saml.js';

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

/** The Conditions section, or empty string when the summary has no conditions. */
export function renderConditions(s) {
  if (!s.conditions) return '';
  return `
    <h3>Conditions</h3>
    <dl class="detail-head" style="display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin-bottom:16px;">
      ${row('NotBefore', s.conditions.notBefore)}
      ${row('NotOnOrAfter', s.conditions.notOnOrAfter)}
      ${row('Audience', s.conditions.audience)}
    </dl>`;
}

/**
 * The wire Parameters table (RelayState + the SAML blob) for a capture.
 * The SAML blob is truncated to a preview; the binding label comes from the
 * capture source. Returns empty string when there are no parameters.
 */
export function renderSamlParams(c) {
  const pairs = [];
  if (c.relayState) pairs.push(['RelayState', c.relayState]);
  const samlKey = c.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
  const samlVal = c.samlResponse || c.samlRequest;
  if (samlVal) pairs.push([samlKey, samlVal]);
  if (!pairs.length) return '';
  const binding = c.source === 'url' ? 'Redirect binding' : 'POST binding';
  const rows = pairs.map(([k, v]) => {
    const isBlob = k === 'SAMLResponse' || k === 'SAMLRequest';
    const display = isBlob
      ? `<span class="muted">${escape(v.slice(0, 64))}…</span>`
      : escape(v);
    return `<tr><td><code>${escape(k)}</code></td><td>${display}</td></tr>`;
  }).join('');
  return `
    <h3 style="margin-top:16px;">Parameters <span class="muted" style="font-weight:normal;font-size:.85em;">(${binding})</span></h3>
    <table class="attrs">
      <tbody>${rows}</tbody>
    </table>`;
}

/** A two-column table of HTTP headers, or empty string when there are none. */
export function renderHeaderTable(label, headers) {
  if (!headers || !headers.length) return '';
  const rows = headers.map(h =>
    `<tr><td><code>${escape(h.name)}</code></td><td>${escape(h.value)}</td></tr>`
  ).join('');
  return `
    <h3 style="margin-top:16px;">${escape(label)}</h3>
    <table class="attrs">
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * The full SAML detail view, shared by all three surfaces.
 *
 * `s` is the summary from summarizeSaml; `xml` the decoded XML; `encoding` the
 * decode label. Surface-specific content is driven by `opts`:
 *   - url           string  — the URL row value
 *   - time          string  — when truthy, a leading Time row (viewer)
 *   - sourceLabel   string  — when truthy, a muted span in the heading (viewer)
 *   - kindFallback  string  — heading fallback when s.kind is absent (viewer)
 *   - params        object  — a capture; when present, the Parameters table (popup)
 *   - networkEntry  object  — when present, the request/response header tables (popup)
 */
export function renderSamlDetail(s, xml, encoding, opts = {}) {
  const { url, time, sourceLabel, kindFallback, params, networkEntry } = opts;
  const heading = escape(s.kind || kindFallback || 'Unknown') +
    (sourceLabel ? ` <span class="muted" style="font-weight:400;font-size:12px;">${escape(sourceLabel)}</span>` : '');
  const head = `
    <div class="detail-head">
      <h2>${heading}</h2>
      <dl>
        ${row('Time', time)}
        ${row('URL', url)}
        ${row('Issuer', s.issuer)}
        ${row('Destination', s.destination)}
        ${row('Subject', s.subject)}
        ${row('Status', s.status)}
        ${row('Issued', s.issueInstant)}
        ${row('Encoding', encoding)}
        ${s.assertionEncrypted ? row('Assertion', 'Encrypted') : ''}
      </dl>
    </div>`;
  const attrs = renderAttributes(s);
  const conds = renderConditions(s);
  const paramsHtml = params ? renderSamlParams(params) : '';
  const headers = networkEntry ? (
    renderHeaderTable('Request Headers', networkEntry.requestHeaders) +
    renderHeaderTable('Response Headers', networkEntry.responseHeaders)
  ) : '';
  return head + attrs + conds + paramsHtml + headers + `
    <details class="raw">
      <summary>Raw XML</summary>
      <pre>${escape(prettyPrintXml(xml))}</pre>
    </details>`;
}
