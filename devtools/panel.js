import { decodeSamlMessage, summarizeSaml, prettyPrintXml } from '../shared/saml.js';
import { escape, row, shortName, truncate, renderAttributes } from '../shared/render.js';
import { initResizer } from '../shared/resizer.js';

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
    const isAuthn = !!c.samlRequest;
    const what = c.samlResponse ? 'SAMLResponse' : 'AuthnRequest';
    li.innerHTML = `
      <div class="row">
        <span class="method">${escape(c.method)}</span>
        <span class="${isAuthn ? 'kind-authn' : 'kind'}">${what}</span>
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
        ${s.assertionEncrypted ? row('Assertion', 'Encrypted') : ''}
      </dl>
    </div>`;
  const attrs = renderAttributes(s);
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


document.getElementById('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear-captures' });
  captures = [];
  selectedId = null;
  renderList();
  statusEl.textContent = '';
  detailEl.innerHTML = '<p class="empty">Cleared.</p>';
});
document.getElementById('open-viewer').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open-app' }).catch(() => {});
});
document.getElementById('open-jwt').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open-app-jwt' }).catch(() => {});
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'capture-added' && msg.entry?.tabId === tabId) refresh();
});

initResizer(document.getElementById('resizer'), document.getElementById('entry-pane'), 'panel-pane-width');

refresh();
