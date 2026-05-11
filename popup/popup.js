import { decodeSamlMessage, summarizeSaml, prettyPrintXml } from '../shared/saml.js';

const entriesEl = document.getElementById('entries');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');

let captures = [];
let networkEntries = [];
let selectedId = null;
let viewMode = 'saml'; // 'saml' | 'network'

// --- view toggle ---

document.getElementById('view-saml').addEventListener('click', () => setView('saml'));
document.getElementById('view-network').addEventListener('click', () => setView('network'));

function setView(mode) {
  viewMode = mode;
  document.getElementById('view-saml').classList.toggle('active', mode === 'saml');
  document.getElementById('view-network').classList.toggle('active', mode === 'network');
  selectedId = null;
  detailEl.innerHTML = '<p class="empty">Select an entry to inspect.</p>';
  if (mode === 'saml') refresh(); else refreshNetwork();
}

// --- SAML view ---

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'list-captures' });
    captures = res?.captures || [];
    statusEl.textContent = captures.length
      ? `${captures.length} capture${captures.length === 1 ? '' : 's'}`
      : '';
    renderSamlList();
    if (selectedId && !captures.find(c => c.id === selectedId)) {
      selectedId = null;
      detailEl.innerHTML = '<p class="empty">Select a SAML capture to inspect.</p>';
    }
  } catch (e) {
    statusEl.textContent = 'Service worker not ready — try reloading.';
  }
}

function renderSamlList() {
  entriesEl.innerHTML = '';
  if (!captures.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No SAML traffic captured yet.';
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
    li.addEventListener('click', () => selectSamlCapture(c.id));
    entriesEl.appendChild(li);
  }
}

async function selectSamlCapture(id) {
  selectedId = id;
  renderSamlList();
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
    detailEl.innerHTML = renderSamlDetail(c, summary, xml, encoding);
  } catch (e) {
    detailEl.innerHTML = `<p class="error">Failed to decode: ${escape(e.message)}</p>`;
  }
}

// --- Network view ---

async function refreshNetwork() {
  try {
    const [netRes, capRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'list-network' }),
      chrome.runtime.sendMessage({ type: 'list-captures' }),
    ]);
    networkEntries = netRes?.network || [];
    captures = capRes?.captures || [];
    statusEl.textContent = networkEntries.length
      ? `${networkEntries.length} request${networkEntries.length === 1 ? '' : 's'}`
      : '';
    renderNetworkList();
  } catch (e) {
    statusEl.textContent = 'Service worker not ready — try reloading.';
  }
}

function renderNetworkList() {
  entriesEl.innerHTML = '';
  if (!networkEntries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No network traffic captured yet.';
    entriesEl.appendChild(li);
    return;
  }
  for (const entry of networkEntries) {
    const samlCapture = captures.find(c => c.requestId === entry.requestId);
    const isError = entry.statusCode >= 400;
    const isSaml = !!samlCapture;
    const li = document.createElement('li');
    li.className = [
      'entry',
      isError ? 'is-error' : '',
      isSaml ? 'is-saml' : '',
      entry.id === selectedId ? 'selected' : '',
    ].filter(Boolean).join(' ');

    const time = new Date(entry.timestamp).toLocaleTimeString();
    const statusClass = entry.statusCode >= 500 ? 'status-err'
      : entry.statusCode >= 400 ? 'status-err'
      : entry.statusCode >= 300 ? 'status-redirect'
      : 'status-ok';

    li.innerHTML = `
      <div class="row">
        <span class="method">${escape(entry.method)}</span>
        <span class="status-badge ${statusClass}">${entry.statusCode}</span>
        ${isSaml ? `<span class="kind">${samlCapture.samlResponse ? 'SAMLResponse' : 'SAMLRequest'}</span>` : ''}
        <span class="time">${time}</span>
      </div>
      <div class="url">${escape(truncate(entry.url, 140))}</div>
    `;
    li.addEventListener('click', () => selectNetworkEntry(entry.id, samlCapture));
    entriesEl.appendChild(li);
  }
}

async function selectNetworkEntry(id, samlCapture) {
  selectedId = id;
  renderNetworkList();
  const entry = networkEntries.find(e => e.id === id);
  if (!entry) return;

  if (samlCapture) {
    detailEl.innerHTML = '<p class="empty">Decoding…</p>';
    const encoded = samlCapture.samlResponse || samlCapture.samlRequest;
    try {
      const { xml, encoding } = await decodeSamlMessage(encoded);
      const summary = summarizeSaml(xml);
      detailEl.innerHTML = renderSamlDetail(samlCapture, summary, xml, encoding);
    } catch (e) {
      detailEl.innerHTML = `<p class="error">Failed to decode: ${escape(e.message)}</p>`;
    }
    return;
  }

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escape(entry.statusLine || String(entry.statusCode))}</h2>
      <dl>
        ${row('URL', entry.url)}
        ${row('Method', entry.method)}
        ${row('Status', entry.statusCode)}
        ${row('Type', entry.type)}
        ${row('Time', new Date(entry.timestamp).toLocaleString())}
      </dl>
    </div>`;
}

// --- shared detail renderers ---

function renderSamlDetail(c, s, xml, encoding) {
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

// --- action buttons ---

document.getElementById('export').addEventListener('click', async () => {
  const [capRes, netRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'list-captures' }),
    chrome.runtime.sendMessage({ type: 'list-network' }),
  ]);
  const caps = capRes?.captures || [];
  const net = netRes?.network || [];

  const netByReqId = new Map(net.map(n => [n.requestId, n]));
  const capByReqId = new Map(caps.map(c => [c.requestId, c]));

  // Start with network entries as the base (they carry status codes)
  const requests = [];
  for (const n of net) {
    const cap = capByReqId.get(n.requestId);
    // res object required by saml-tracer's export: req.getResponse() must not return null
    const res = { statusCode: n.statusCode, statusLine: n.statusLine, responseHeaders: [] };
    const req = {
      requestId: n.requestId,
      url: n.url,
      method: n.method,
      type: n.type,
      timestamp: n.timestamp,
      responseStatus: n.statusCode,
      responseStatusText: n.statusLine,
      requestHeaders: [],
      responseHeaders: [],
      res,
    };
    if (cap) {
      req.protocol = 'SAML-P';
      req.samlart = null;
      const samlKey = cap.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
      const samlVal = cap.samlResponse || cap.samlRequest;
      let xml = null;
      try { ({ xml } = await decodeSamlMessage(samlVal)); } catch (_) {}
      req.saml = xml;
      if (cap.source === 'url') {
        req.get = cap.relayState
          ? [['RelayState', cap.relayState], [samlKey, samlVal]]
          : [[samlKey, samlVal]];
      } else {
        req.postData = { ...(cap.relayState ? { RelayState: [cap.relayState] } : {}), [samlKey]: [samlVal] };
        req.post = [
          ...(cap.relayState ? [['RelayState', cap.relayState]] : []),
          [samlKey, samlVal],
        ];
      }
    }
    requests.push(req);
  }

  // Include any SAML captures that had no matching network entry
  for (const cap of caps) {
    if (!netByReqId.has(cap.requestId)) {
      const samlKey = cap.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
      const samlVal = cap.samlResponse || cap.samlRequest;
      let xml = null;
      try { ({ xml } = await decodeSamlMessage(samlVal)); } catch (_) {}
      const req = {
        requestId: cap.requestId,
        url: cap.url,
        method: cap.method,
        type: cap.type,
        timestamp: cap.timestamp,
        protocol: 'SAML-P',
        samlart: null,
        saml: xml,
        requestHeaders: [],
        responseHeaders: [],
        res: { statusCode: 0, statusLine: '', responseHeaders: [] },
      };
      if (cap.source === 'url') {
        req.get = cap.relayState
          ? [['RelayState', cap.relayState], [samlKey, samlVal]]
          : [[samlKey, samlVal]];
      } else {
        req.postData = { ...(cap.relayState ? { RelayState: [cap.relayState] } : {}), [samlKey]: [samlVal] };
        req.post = [
          ...(cap.relayState ? [['RelayState', cap.relayState]] : []),
          [samlKey, samlVal],
        ];
      }
      requests.push(req);
    }
  }

  requests.sort((a, b) => a.timestamp - b.timestamp);

  const data = { requests, timestamp: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SAML-tracer-export-${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear-captures' });
  captures = [];
  networkEntries = [];
  selectedId = null;
  statusEl.textContent = '';
  detailEl.innerHTML = '<p class="empty">Cleared.</p>';
  if (viewMode === 'saml') renderSamlList(); else renderNetworkList();
});

document.getElementById('open-viewer').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer/viewer.html') });
});

document.getElementById('open-jwt').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('jwt/jwt.html') });
});

// --- live updates ---

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'capture-added' && viewMode === 'saml') refresh();
  if (msg.type === 'network-added' && viewMode === 'network') refreshNetwork();
});

// --- helpers ---

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
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

refresh();
