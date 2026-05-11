import { decodeSamlMessage, summarizeSaml, prettyPrintXml } from '../shared/saml.js';

const tabId = chrome.devtools.inspectedWindow.tabId;
const entriesEl = document.getElementById('entries');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');

let captures = [];
let selectedId = null;

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'list-captures' });
    const all = res?.captures || [];
    captures = all.filter(c => c.tabId === tabId);
    statusEl.textContent = captures.length
      ? `${captures.length} capture${captures.length === 1 ? '' : 's'} on this tab`
      : '';
    renderList();
    if (selectedId && !captures.find(c => c.id === selectedId)) {
      selectedId = null;
      detailEl.innerHTML = '<p class="empty">Select a SAML capture to inspect.</p>';
    }
  } catch (e) {
    statusEl.textContent = 'Service worker not ready — try reloading.';
  }
}

function renderList() {
  entriesEl.innerHTML = '';
  if (!captures.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No SAML traffic captured on this tab yet.';
    entriesEl.appendChild(li);
    return;
  }
  for (const c of captures) {
    const li = document.createElement('li');
    li.className = 'entry' + (c.id === selectedId ? ' selected' : '');
    const time = new Date(c.timestamp).toLocaleTimeString();
    const what = c.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
    li.innerHTML = `
      <div class="row">
        <span class="method">${escape(c.method)}</span>
        <span class="kind">${what}</span>
        <span class="time">${time}</span>
      </div>
      <div class="url">${escape(truncate(c.url, 140))}</div>
    `;
    li.addEventListener('click', () => selectCapture(c.id));
    entriesEl.appendChild(li);
  }
}

async function selectCapture(id) {
  selectedId = id;
  renderList();
  const c = captures.find(x => x.id === id);
  if (!c) return;
  detailEl.innerHTML = '<p class="empty">Decoding…</p>';
  const encoded = c.samlResponse || c.samlRequest;
  if (!encoded) {
    detailEl.innerHTML = '<p class="empty">No SAML payload found.</p>';
    return;
  }
  try {
    const { xml, encoding } = await decodeSamlMessage(encoded);
    const summary = summarizeSaml(xml);
    detailEl.innerHTML = renderDetail(c, summary, xml, encoding);
  } catch (e) {
    detailEl.innerHTML = `<p class="error">Failed to decode: ${escape(e.message)}</p>`;
  }
}

function renderDetail(c, s, xml, encoding) {
  const head = `
    <div class="detail-head">
      <h2>${escape(s.kind || 'Unknown')}</h2>
      <dl>
        ${row('URL', c.url)}
        ${row('Issuer', s.issuer)}
        ${row('Destination', s.destination)}
        ${row('Subject', s.subject)}
        ${row('Status', s.status)}
        ${row('Issued', s.issueInstant)}
        ${row('Encoding', encoding)}
      </dl>
    </div>`;
  const attrs = renderAttributes(s.attributes || []);
  const conds = s.conditions ? `
    <h3>Conditions</h3>
    <dl class="detail-head" style="display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin-bottom:16px;">
      ${row('NotBefore', s.conditions.notBefore)}
      ${row('NotOnOrAfter', s.conditions.notOnOrAfter)}
      ${row('Audience', s.conditions.audience)}
    </dl>` : '';
  return head + attrs + conds + `
    <details class="raw">
      <summary>Raw XML</summary>
      <pre>${escape(prettyPrintXml(xml))}</pre>
    </details>`;
}

function renderAttributes(attrs) {
  if (!attrs.length) return '<p class="empty">No SAML attributes in this message.</p>';
  const rows = attrs.map(a => `
    <tr>
      <td><code>${escape(a.friendlyName || shortName(a.name))}</code></td>
      <td><code class="muted">${escape(a.name || '')}</code></td>
      <td>${a.values.length
        ? a.values.map(v => `<div>${escape(v)}</div>`).join('')
        : '<span class="muted">(no values)</span>'}</td>
    </tr>`).join('');
  return `
    <h3 style="margin-top:16px;">Attributes (${attrs.length})</h3>
    <table class="attrs">
      <thead><tr><th>Friendly</th><th>Name</th><th>Value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function shortName(name) {
  if (!name) return '';
  const m = name.match(/[/#:]([^/#:]+)$/);
  return m ? m[1] : name;
}
function row(label, value) {
  if (value == null || value === '') return '';
  return `<dt>${escape(label)}</dt><dd>${escape(String(value))}</dd>`;
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear-captures' });
  captures = [];
  selectedId = null;
  renderList();
  statusEl.textContent = '';
  detailEl.innerHTML = '<p class="empty">Cleared.</p>';
});
document.getElementById('open-viewer').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer/viewer.html') });
});
document.getElementById('open-jwt').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('jwt/jwt.html') });
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'capture-added' && msg.entry?.tabId === tabId) refresh();
});

refresh();
