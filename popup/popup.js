import { decodeSamlMessage, summarizeSaml, prettyPrintXml } from '../shared/saml.js';
import { decodeJwt } from '../shared/jwt.js';
import {
  escape, row, shortName, truncate,
  renderHeaderTable, renderSamlDetail, renderSettingHelp,
} from '../shared/render.js';
import { ICONS } from '../shared/icons.js';
import { mountMetaCompare } from '../shared/metacompare-ui.js';
import { isBetaActive, redeemBetaCode, deactivateBeta } from '../shared/license.js';
import { shouldShowReviewNudgeNow, markReviewRated, markReviewDismissed, REVIEW_URL } from '../shared/review.js';
import { initResizer } from '../shared/resizer.js';

// Append the Pro MetaCompare section under a freshly-rendered SAML detail.
function appendMetaCompare(summary) {
  const container = document.createElement('div');
  detailEl.appendChild(container);
  mountMetaCompare(container, summary).catch(() => {});
}

// One-time, dismissible "rate the extension" nudge — shown only once the user
// has accumulated enough live captures to have gotten value from the tool.
async function maybeShowReviewNudge() {
  const banner = document.getElementById('review-banner');
  if (importedMode) { banner.classList.add('hidden'); return; }
  if (!(await shouldShowReviewNudgeNow(captures.length))) return;
  banner.innerHTML = `
    <span class="review-banner-msg">Enjoying Awesome SAML Tracer? A quick rating really helps.</span>
    <button id="review-rate">Rate it</button>
    <button id="review-dismiss" class="ghost">Maybe later</button>`;
  banner.classList.remove('hidden');
  document.getElementById('review-rate').addEventListener('click', async () => {
    chrome.tabs.create({ url: REVIEW_URL });
    await markReviewRated();
    banner.classList.add('hidden');
  });
  document.getElementById('review-dismiss').addEventListener('click', async () => {
    await markReviewDismissed();
    banner.classList.add('hidden');
  });
}

// Populate the static header buttons with their inline SVG icons. The pause
// button is intentionally left out — applyPausedState() sets it (play vs pause)
// and runs on load via the get-paused sync.
const HEADER_ICONS = {
  clear: 'trash-2',
  export: 'download',
  'open-viewer': 'upload',
  'share-report': 'file-text',
  'settings-btn': 'settings',
  'site-btn': 'globe',
  'kofi-btn': 'coffee',
};
for (const [id, name] of Object.entries(HEADER_ICONS)) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = ICONS[name];
}

const entriesEl = document.getElementById('entries');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');

let captures = [];
let networkEntries = [];
let selectedId = null;
let viewMode = 'saml'; // 'saml' | 'network'
let importedMode = false;
let settings = { highlightDomains: [], importantHeaders: [], queryParamPatterns: [], urlExtractions: [] };
let searchQuery = '';

// --- settings ---

async function loadSettings() {
  const data = await chrome.storage.local.get('settings').catch(() => ({}));
  const raw = data.settings || {};
  settings = {
    highlightDomains:   raw.highlightDomains   || [],
    importantHeaders:   raw.importantHeaders   || [],
    queryParamPatterns: raw.queryParamPatterns || [],
    urlExtractions:     raw.urlExtractions     || [],
  };
}

function matchesHighlight(url) {
  if (!url || !settings.highlightDomains.length) return false;
  const u = url.toLowerCase();
  return settings.highlightDomains.some(p => {
    const term = p.replace(/^\*+/, '').toLowerCase();
    return term && u.includes(term);
  });
}

const settingsPanel = document.getElementById('settings-panel');
const settingDomainsEl = document.getElementById('setting-domains');
const settingHeadersEl = document.getElementById('setting-headers');
const settingQsPatternsEl = document.getElementById('setting-qs-patterns');
const settingUrlExtractionsEl = document.getElementById('setting-url-extractions');

function parseUrlExtractions(text) {
  return text.split('\n').map(line => {
    const idx = line.indexOf('|');
    if (idx === -1) return null;
    const label = line.slice(0, idx).trim();
    const pattern = line.slice(idx + 1).trim();
    return label && pattern ? { label, pattern } : null;
  }).filter(Boolean);
}

function urlExtractionsToText(rules) {
  return rules.map(r => `${r.label} | ${r.pattern}`).join('\n');
}

document.getElementById('settings-btn').addEventListener('click', () => {
  const opening = settingsPanel.classList.contains('hidden');
  if (opening) {
    settingDomainsEl.value = settings.highlightDomains.join('\n');
    settingHeadersEl.value = settings.importantHeaders.join('\n');
    settingQsPatternsEl.value = settings.queryParamPatterns.join('\n');
    settingUrlExtractionsEl.value = urlExtractionsToText(settings.urlExtractions);
  }
  settingsPanel.classList.toggle('hidden', !opening);
  if (!opening) closeHelp();
  if (opening) renderBetaStatus();
});

// --- beta Pro unlock ---

const betaCodeEl = document.getElementById('beta-code');
const betaActivateBtn = document.getElementById('beta-activate');
const betaStatusEl = document.getElementById('beta-status');

async function renderBetaStatus() {
  const active = await isBetaActive();
  betaStatusEl.textContent = active ? '✓ Pro unlocked on this device (beta).' : '';
  betaActivateBtn.textContent = active ? 'Deactivate' : 'Activate';
  betaCodeEl.style.display = active ? 'none' : '';
}

betaActivateBtn.addEventListener('click', async () => {
  if (await isBetaActive()) {
    await deactivateBeta();
    betaCodeEl.value = '';
  } else {
    const ok = await redeemBetaCode(betaCodeEl.value);
    if (!ok) { betaStatusEl.textContent = 'That code isn’t valid.'; return; }
  }
  await renderBetaStatus();
  // Re-render the open capture so MetaCompare appears/disappears immediately.
  if (selectedId != null && viewMode === 'saml') refresh();
});

document.getElementById('settings-save').addEventListener('click', async () => {
  settings.highlightDomains   = settingDomainsEl.value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.importantHeaders   = settingHeadersEl.value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.queryParamPatterns = settingQsPatternsEl.value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.urlExtractions     = parseUrlExtractions(settingUrlExtractionsEl.value);
  await chrome.storage.local.set({ settings }).catch(() => {});
  settingsPanel.classList.add('hidden');
  closeHelp();
  updateInfoBar([], [], null, null);
  if (viewMode === 'saml') refresh();
  else if (viewMode === 'network' || viewMode === 'errors') refreshNetwork();
});

document.getElementById('settings-cancel').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  closeHelp();
});

// --- per-setting help popover ---

const DOCS_URL = 'https://ast-web.pages.dev/how-to#settings';

const SETTING_HELP = {
  'setting-domains': {
    title: 'Highlight domains',
    examples: ['*mycompany.com', '*okta.com'],
    note: 'One pattern per line. Matching captures get a ★ and a highlight in the list.',
  },
  'setting-headers': {
    title: 'Important Headers / Parameters',
    examples: ['X-Global-Transaction-Id', 'RelayState', 'SAMLResponse'],
    note: 'Header or SAML parameter names (one per line) pinned to the info bar when present.',
  },
  'setting-qs-patterns': {
    title: 'Show query params for',
    examples: ['*myapp*', '*mycompany.com/api*'],
    note: 'When the URL matches, all query-string params are shown — including ones after the # fragment.',
  },
  'setting-url-extractions': {
    title: 'Extract from URL path',
    examples: ['Config ID | *myapp*', 'Tenant | *tenants/*/config*'],
    note: 'Format: label | pattern. Extracts the last path segment when the URL matches.',
  },
};

const helpPopover = document.getElementById('help-popover');
let helpOpenFor = null;

function closeHelp() {
  helpPopover.classList.add('hidden');
  helpOpenFor = null;
}

function openHelp(trigger) {
  const id = trigger.dataset.help;
  const content = SETTING_HELP[id];
  if (!content) return;
  helpPopover.innerHTML = renderSettingHelp(content, DOCS_URL);
  helpPopover.classList.remove('hidden');
  // Position below the trigger, clamped to the viewport's right edge.
  const r = trigger.getBoundingClientRect();
  const width = helpPopover.offsetWidth || 260;
  const left = Math.min(r.left, window.innerWidth - width - 8);
  helpPopover.style.top = `${r.bottom + 6}px`;
  helpPopover.style.left = `${Math.max(8, left)}px`;
  helpOpenFor = id;
}

document.querySelectorAll('.help-trigger').forEach(trigger => {
  trigger.innerHTML = ICONS['circle-help'];
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpOpenFor === trigger.dataset.help) closeHelp();
    else openHelp(trigger);
  });
});

document.addEventListener('click', (e) => {
  if (helpOpenFor === null) return;
  if (!helpPopover.contains(e.target) && !e.target.closest('.help-trigger')) closeHelp();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });

// --- important info bar ---

const infoBar = document.getElementById('info-bar');

function matchesPattern(url, pattern) {
  const term = pattern.replace(/^\*+/, '').replace(/\*+$/, '').toLowerCase();
  return term ? url.toLowerCase().includes(term) : false;
}

function matchesQueryPattern(url) {
  if (!url || !settings.queryParamPatterns.length) return false;
  return settings.queryParamPatterns.some(p => matchesPattern(url, p));
}

// Collect query params from both the real query string and any query string
// embedded in the fragment. Hash-routed SPAs put params after the # (e.g.
// .../disclaimers/#/?ssoId=...&spaceId=...), where URL.searchParams can't see
// them. Real query params win on key collision (pushed first).
function collectQueryParams(url) {
  const out = [];
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams.entries()) out.push([k, v]);
    const q = u.hash.indexOf('?');
    if (q !== -1) {
      for (const [k, v] of new URLSearchParams(u.hash.slice(q + 1)).entries()) {
        out.push([k, v]);
      }
    }
  } catch { /* invalid URL */ }
  return out;
}

function lastPathSegment(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch { return null; }
}

function updateInfoBar(requestHeaders, responseHeaders, samlCapture, url) {
  const allHeaders = [...(responseHeaders || []), ...(requestHeaders || [])];
  const samlParams = samlCapture ? {
    relaystate:   samlCapture.relayState   ?? null,
    samlresponse: samlCapture.samlResponse ?? null,
    samlrequest:  samlCapture.samlRequest  ?? null,
  } : {};

  // Section 1: important headers/params
  const importantResults = settings.importantHeaders.map(name => {
    const key = name.toLowerCase();
    const fromHeader = allHeaders.find(h => h.name.toLowerCase() === key);
    if (fromHeader) return { name, value: fromHeader.value };
    return { name, value: samlParams[key] ?? null };
  });

  // Section 2: query string params when URL matches a pattern
  let qsResults = [];
  if (url && matchesQueryPattern(url)) {
    qsResults = collectQueryParams(url).map(([k, v]) => ({ name: k, value: v }));
  }

  // Section 3: URL path extractions
  const extractionResults = url ? settings.urlExtractions
    .filter(r => matchesPattern(url, r.pattern))
    .map(r => ({ label: r.label, value: lastPathSegment(url) }))
    .filter(r => r.value !== null) : [];

  const hasImportant = settings.importantHeaders.length > 0;
  const hasQs = qsResults.length > 0;
  const hasExtractions = extractionResults.length > 0;
  if (!hasImportant && !hasQs && !hasExtractions) { infoBar.classList.add('hidden'); return; }
  infoBar.classList.remove('hidden');

  const allCopyable = [];
  let html = '';

  if (hasImportant) {
    html += '<span class="info-bar-label">Important</span>';
    for (const { name, value } of importantResults) {
      if (value !== null) allCopyable.push(value);
      html += `<div class="info-chip">
        <span class="info-chip-name">${escape(name)}</span>
        <span class="info-chip-value${value === null ? ' empty' : ''}">${value !== null ? escape(value) : '—'}</span>
        ${value !== null ? `<button class="info-chip-copy" title="Copy to clipboard">${ICONS.copy}</button>` : ''}
      </div>`;
    }
  }

  if (hasQs) {
    if (hasImportant) html += '<span class="info-bar-sep"></span>';
    html += '<span class="info-bar-label">Query Params</span>';
    for (const { name, value } of qsResults) {
      allCopyable.push(value);
      html += `<div class="info-chip">
        <span class="info-chip-name">${escape(name)}</span>
        <span class="info-chip-value">${escape(value)}</span>
        <button class="info-chip-copy" title="Copy to clipboard">${ICONS.copy}</button>
      </div>`;
    }
  }

  if (hasExtractions) {
    if (hasImportant || hasQs) html += '<span class="info-bar-sep"></span>';
    for (const { label, value } of extractionResults) {
      allCopyable.push(value);
      html += `<div class="info-chip">
        <span class="info-chip-name">${escape(label)}</span>
        <span class="info-chip-value">${escape(value)}</span>
        <button class="info-chip-copy" title="Copy to clipboard">${ICONS.copy}</button>
      </div>`;
    }
  }

  infoBar.innerHTML = html;

  [...infoBar.querySelectorAll('.info-chip-copy')].forEach((btn, i) => {
    const raw = allCopyable[i];
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(raw).catch(() => {});
      btn.classList.add('copied');
      btn.innerHTML = ICONS.check;
      setTimeout(() => { btn.innerHTML = ICONS.copy; btn.classList.remove('copied'); }, 1500);
    });
  });
}

// --- search ---

const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value.trim().toLowerCase();
  if (viewMode === 'saml') renderSamlList();
  else if (viewMode === 'network') renderNetworkList();
});

// --- pause toggle ---

const pauseBtn = document.getElementById('pause');

function applyPausedState(paused) {
  pauseBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
  pauseBtn.dataset.tooltip = paused ? 'Resume' : 'Pause';
  pauseBtn.classList.toggle('paused', paused);
  pauseBtn.classList.toggle('ghost', !paused);
}

pauseBtn.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'toggle-pause' });
  applyPausedState(res.paused);
});

// Sync button state with the service worker on load.
chrome.runtime.sendMessage({ type: 'get-paused' }).then(res => applyPausedState(res?.paused ?? false)).catch(() => {});

// --- view toggle ---

document.getElementById('view-saml').addEventListener('click', () => setView('saml'));
document.getElementById('view-network').addEventListener('click', () => setView('network'));
document.getElementById('view-errors').addEventListener('click', () => setView('errors'));
document.getElementById('view-jwt').addEventListener('click', () => setView('jwt'));

const mainLayout = document.getElementById('main-layout');
const jwtView = document.getElementById('jwt-view');

function setView(mode) {
  viewMode = mode;
  document.getElementById('view-saml').classList.toggle('active', mode === 'saml');
  document.getElementById('view-network').classList.toggle('active', mode === 'network');
  document.getElementById('view-errors').classList.toggle('active', mode === 'errors');
  document.getElementById('view-jwt').classList.toggle('active', mode === 'jwt');
  mainLayout.classList.toggle('hidden', mode === 'jwt');
  jwtView.classList.toggle('hidden', mode !== 'jwt');
  selectedId = null;
  searchQuery = '';
  searchEl.value = '';
  updateInfoBar([], [], null, null);
  if (mode === 'saml') {
    detailEl.innerHTML = '<p class="empty">Select an entry to inspect.</p>';
    refresh();
  } else if (mode === 'network' || mode === 'errors') {
    detailEl.innerHTML = '<p class="empty">Select an entry to inspect.</p>';
    refreshNetwork();
  }
}

// --- errors button state ---

function syncErrorsButton() {
  const btn = document.getElementById('view-errors');
  const hasErrors = networkEntries.some(e => e.statusCode >= 400);
  btn.disabled = !hasErrors;
  if (!hasErrors && viewMode === 'errors') setView('network');
}

// --- SAML view ---

async function refresh() {
  if (importedMode) { renderSamlList(); syncErrorsButton(); return; }
  try {
    const [capRes, netRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'list-captures' }),
      chrome.runtime.sendMessage({ type: 'list-network' }),
    ]);
    captures = capRes?.captures || [];
    networkEntries = netRes?.network || [];
    statusEl.textContent = captures.length
      ? `${captures.length} capture${captures.length === 1 ? '' : 's'}`
      : '';
    renderSamlList();
    syncErrorsButton();
    maybeShowReviewNudge();
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
  const visible = captures.filter(c =>
    matchesSearch(c.url, c.method, c.samlResponse ? 'samlresponse' : 'samlrequest')
  );
  if (!captures.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No SAML traffic captured yet.';
    entriesEl.appendChild(li);
    return;
  }
  if (!visible.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No results match your filter.';
    entriesEl.appendChild(li);
    return;
  }
  for (const c of visible) {
    const li = document.createElement('li');
    const isHighlight = matchesHighlight(c.url);
    li.className = ['entry', isHighlight ? 'is-highlight' : '', c.id === selectedId ? 'selected' : ''].filter(Boolean).join(' ');
    const time = new Date(c.timestamp).toLocaleTimeString();
    const isAuthn = !!c.samlRequest;
    const what = c.samlResponse ? 'SAMLResponse' : 'AuthnRequest';
    li.innerHTML = `
      <div class="row">
        <span class="method ${methodClass(c.method)}">${escape(c.method)}</span>
        <span class="${isAuthn ? 'kind-authn' : 'kind'}">${what}</span>
        ${isHighlight ? '<span class="kind-domain">★</span>' : ''}
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
  const netEntry = networkEntries.find(n => n.requestId === c.requestId);
  updateInfoBar(netEntry?.requestHeaders, netEntry?.responseHeaders, c, c.url);
  detailEl.innerHTML = '<p class="empty">Decoding…</p>';
  const encoded = c.samlResponse || c.samlRequest;
  if (!encoded) {
    detailEl.innerHTML = '<p class="empty">No SAML payload found.</p>';
    return;
  }
  try {
    const { xml, encoding } = await decodeSamlMessage(encoded);
    const summary = summarizeSaml(xml);
    detailEl.innerHTML = renderSamlDetail(summary, xml, encoding, { url: c.url, params: c, networkEntry: netEntry });
    addCopyButton(() => buildSamlCaptureText(c, summary, xml, encoding, netEntry));
    appendMetaCompare(summary);
  } catch (e) {
    detailEl.innerHTML = `<p class="error">Failed to decode: ${escape(e.message)}</p>`;
  }
}

// --- Network view ---

async function refreshNetwork() {
  if (importedMode) { renderNetworkList(); syncErrorsButton(); return; }
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
    syncErrorsButton();
  } catch (e) {
    statusEl.textContent = 'Service worker not ready — try reloading.';
  }
}

function renderNetworkList() {
  entriesEl.innerHTML = '';
  const pool = viewMode === 'errors'
    ? networkEntries.filter(e => e.statusCode >= 400)
    : networkEntries;
  const visible = pool.filter(e =>
    matchesSearch(e.url, e.method, String(e.statusCode || ''))
  );
  if (!networkEntries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No network traffic captured yet.';
    entriesEl.appendChild(li);
    return;
  }
  if (!visible.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = viewMode === 'errors' ? 'No error responses captured yet.' : 'No results match your filter.';
    entriesEl.appendChild(li);
    return;
  }
  for (const entry of visible) {
    const samlCapture = captures.find(c => c.requestId === entry.requestId && c.url === entry.url);
    const isError = entry.statusCode >= 400;
    const isSaml = !!samlCapture;
    const isHighlight = matchesHighlight(entry.url);
    const li = document.createElement('li');
    li.className = [
      'entry',
      isError ? 'is-error' : '',
      isSaml ? 'is-saml' : '',
      isHighlight ? 'is-highlight' : '',
      entry.id === selectedId ? 'selected' : '',
    ].filter(Boolean).join(' ');

    const time = new Date(entry.timestamp).toLocaleTimeString();
    const statusClass = entry.statusCode >= 500 ? 'status-err'
      : entry.statusCode >= 400 ? 'status-err'
      : entry.statusCode >= 300 ? 'status-redirect'
      : 'status-ok';

    li.innerHTML = `
      <div class="row">
        <span class="method ${methodClass(entry.method)}">${escape(entry.method)}</span>
        <span class="status-badge ${statusClass}">${entry.statusCode}</span>
        ${isSaml ? `<span class="${samlCapture.samlResponse ? 'kind' : 'kind-authn'}">${samlCapture.samlResponse ? 'SAMLResponse' : 'AuthnRequest'}</span>` : ''}
        ${isHighlight ? '<span class="kind-domain">★</span>' : ''}
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

  updateInfoBar(entry.requestHeaders, entry.responseHeaders, samlCapture, entry.url);

  if (samlCapture) {
    detailEl.innerHTML = '<p class="empty">Decoding…</p>';
    const encoded = samlCapture.samlResponse || samlCapture.samlRequest;
    try {
      const { xml, encoding } = await decodeSamlMessage(encoded);
      const summary = summarizeSaml(xml);
      detailEl.innerHTML = renderSamlDetail(summary, xml, encoding, { url: samlCapture.url, params: samlCapture, networkEntry: entry });
      addCopyButton(() => buildSamlCaptureText(samlCapture, summary, xml, encoding, entry));
      appendMetaCompare(summary);
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
    </div>
    ${renderHeaderTable('Request Headers', entry.requestHeaders)}
    ${renderHeaderTable('Response Headers', entry.responseHeaders)}`;
  addCopyButton(() => buildNetworkEntryText(entry));
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
    const res = { statusCode: n.statusCode, statusLine: n.statusLine, responseHeaders: n.responseHeaders || [] };
    const req = {
      requestId: n.requestId,
      url: n.url,
      method: n.method,
      type: n.type,
      timestamp: n.timestamp,
      responseStatus: n.statusCode,
      responseStatusText: n.statusLine,
      requestHeaders: n.requestHeaders || [],
      responseHeaders: n.responseHeaders || [],
      res,
    };
    if (cap) {
      // Chrome reuses the requestId across a redirect chain; onCompleted fires for the
      // final hop (often a GET), so n.url and n.method reflect the redirect target, not
      // the original SAML POST. Override with the capture's original values so
      // saml-tracer's loadPOST runs and protocol detection succeeds on import.
      req.url = cap.url;
      req.method = cap.method;
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

// --- share: HTML report + clipboard copy ---

async function buildReportData() {
  const reportCaptures = [];
  for (const c of captures) {
    const encoded = c.samlResponse || c.samlRequest;
    let xml = null, encoding = null, summary = null;
    if (encoded) {
      try {
        ({ xml, encoding } = await decodeSamlMessage(encoded));
        summary = summarizeSaml(xml);
      } catch (_) {}
    }
    const netEntry = networkEntries.find(n => n.requestId === c.requestId);
    reportCaptures.push({ capture: c, summary, xml, encoding, netEntry });
  }
  return { reportCaptures, allNetwork: [...networkEntries] };
}

function rptRow(label, value) {
  if (value == null || value === '') return '';
  return `<tr><td class="lbl">${escape(label)}</td><td>${escape(String(value))}</td></tr>`;
}

function rptHeaderTable(label, headers) {
  if (!headers || !headers.length) return '';
  const rows = headers.map(h => `<tr><td class="lbl">${escape(h.name)}</td><td>${escape(h.value)}</td></tr>`).join('');
  return `<h4>${escape(label)}</h4><table class="htbl"><tbody>${rows}</tbody></table>`;
}

async function buildHtmlString() {
  const { reportCaptures, allNetwork } = await buildReportData();
  const nowStr = new Date().toLocaleString();

  const samlSections = reportCaptures.map((item, i) => {
    const { capture: c, summary: s, xml, encoding, netEntry } = item;
    const what = c.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
    const time = new Date(c.timestamp).toLocaleString();
    const statusCode = netEntry?.statusCode ?? '';

    const attrRows = !s?.attributes?.length
      ? '<tr><td colspan="3" class="muted">No attributes</td></tr>'
      : s.attributes.map(a => `<tr>
          <td>${escape(a.friendlyName || shortName(a.name))}</td>
          <td class="muted mono">${escape(a.name || '')}</td>
          <td>${a.values.length ? a.values.map(v => escape(v)).join('<br>') : '<span class="muted">(no values)</span>'}</td>
        </tr>`).join('');

    const condBlock = s?.conditions ? `
      <h4>Conditions</h4>
      <table class="htbl"><tbody>
        ${rptRow('Not Before', s.conditions.notBefore)}
        ${rptRow('Not On Or After', s.conditions.notOnOrAfter)}
        ${rptRow('Audience', s.conditions.audience)}
      </tbody></table>` : '';

    const paramPairs = [];
    if (c.relayState) paramPairs.push(['RelayState', c.relayState]);
    const samlKey = c.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
    const samlVal = c.samlResponse || c.samlRequest;
    if (samlVal) paramPairs.push([samlKey, samlVal.slice(0, 80) + '…']);
    const paramBlock = paramPairs.length ? `
      <h4>Parameters (${c.source === 'url' ? 'Redirect binding' : 'POST binding'})</h4>
      <table class="htbl"><tbody>
        ${paramPairs.map(([k, v]) => `<tr><td class="lbl mono">${escape(k)}</td><td class="mono muted">${escape(v)}</td></tr>`).join('')}
      </tbody></table>` : '';

    const errorNote = !s && xml === null ? '<p class="error">Could not decode SAML payload.</p>' : '';

    return `
      <div class="capture-card">
        <div class="capture-head">
          <span class="badge ${what.toLowerCase()}">${escape(what)}</span>
          <span class="method">${escape(c.method)}</span>
          ${statusCode ? `<span class="status">${escape(String(statusCode))}</span>` : ''}
          <span class="cap-time">${escape(time)}</span>
        </div>
        <div class="cap-url">${escape(c.url)}</div>
        ${errorNote}
        ${s ? `
          <table class="htbl" style="margin-top:12px"><tbody>
            ${rptRow('Issuer', s.issuer)}
            ${rptRow('Destination', s.destination)}
            ${rptRow('Subject', s.subject)}
            ${rptRow('Status', s.status)}
            ${rptRow('Encoding', encoding)}
          </tbody></table>
          ${condBlock}
          <h4>Attributes (${s.attributes?.length ?? 0})</h4>
          <table class="attrs"><thead><tr><th>Friendly Name</th><th>Full Name</th><th>Value(s)</th></tr></thead>
            <tbody>${attrRows}</tbody>
          </table>
          ${paramBlock}
        ` : ''}
        ${rptHeaderTable('Request Headers', netEntry?.requestHeaders)}
        ${rptHeaderTable('Response Headers', netEntry?.responseHeaders)}
        ${xml ? `
          <details>
            <summary>Raw XML</summary>
            <pre class="xml">${escape(prettyPrintXml(xml))}</pre>
          </details>` : ''}
      </div>`;
  }).join('');

  const networkRows = allNetwork.map(e => {
    const statusClass = e.statusCode >= 400 ? 'err' : e.statusCode >= 300 ? 'redir' : 'ok';
    const isSaml = captures.some(c => c.requestId === e.requestId);
    const time = new Date(e.timestamp).toLocaleTimeString();
    const reqText = e.requestHeaders?.map(h => `  ${h.name}: ${h.value}`).join('\n') || '';
    const resText = e.responseHeaders?.map(h => `  ${h.name}: ${h.value}`).join('\n') || '';
    const hdrBlock = (reqText || resText) ? `
      <details>
        <summary>Headers</summary>
        ${reqText ? `<div class="hdr-sect"><strong>Request</strong><pre>${escape(reqText)}</pre></div>` : ''}
        ${resText ? `<div class="hdr-sect"><strong>Response</strong><pre>${escape(resText)}</pre></div>` : ''}
      </details>` : '';
    return `<tr${isSaml ? ' class="saml-row"' : ''}>
      <td class="method">${escape(e.method)}</td>
      <td class="status ${statusClass}">${escape(String(e.statusCode || ''))}</td>
      <td class="net-url">${escape(e.url)}</td>
      <td class="time-col">${escape(time)}</td>
      <td>${hdrBlock}</td>
    </tr>`;
  }).join('');

  const css = `
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d2433;background:#fff;margin:0;padding:0;font-size:14px;line-height:1.5}
    header{background:#f5f7fa;border-bottom:1px solid #e3e6eb;padding:20px 32px}
    header h1{margin:0 0 4px;font-size:22px}
    header p{margin:0;color:#6a7280;font-size:13px}
    main{padding:24px 32px;max-width:1100px}
    h2{font-size:17px;border-bottom:2px solid #e3e6eb;padding-bottom:8px;margin:28px 0 16px}
    h4{font-size:12px;color:#6a7280;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 6px;font-weight:600}
    .capture-card{border:1px solid #e3e6eb;border-radius:8px;padding:16px 20px;margin-bottom:16px;background:#f9fafb}
    .capture-head{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
    .badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600}
    .badge.samlresponse{background:rgba(51,103,214,.12);color:#3367d6}
    .badge.samlrequest{background:rgba(26,127,55,.12);color:#1a7f37}
    .capture-head .method{font-weight:700;font-size:12px}
    .capture-head .status{font-size:12px;font-weight:600;color:#6a7280}
    .cap-time{font-size:12px;color:#6a7280;margin-left:auto}
    .cap-url{font-size:12px;color:#6a7280;word-break:break-all;margin-bottom:8px}
    .htbl{width:100%;border-collapse:collapse;margin:4px 0 12px}
    .htbl td{padding:4px 8px;border-bottom:1px solid #e3e6eb;font-size:13px;vertical-align:top}
    .htbl td.lbl{color:#6a7280;white-space:nowrap;width:1%;padding-right:16px;font-weight:500}
    .mono{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:12px}
    .htbl td.mono{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:12px}
    table.attrs{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:13px}
    table.attrs th,table.attrs td{padding:5px 8px;border-bottom:1px solid #e3e6eb;text-align:left;vertical-align:top}
    table.attrs th{color:#6a7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#f1f3f5}
    table.attrs td.muted{color:#6a7280;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px}
    .muted{color:#6a7280}.error{color:#c5221f}
    details summary{cursor:pointer;color:#6a7280;font-size:13px;padding:4px 0;user-select:none}
    details summary:hover{color:#3367d6}
    details[open] summary{margin-bottom:8px}
    pre.xml{background:#f1f3f5;padding:12px;border-radius:4px;overflow:auto;font-size:11px;font-family:ui-monospace,'SF Mono',Menlo,monospace;margin:0;max-height:400px}
    .hdr-sect{margin-bottom:8px}
    .hdr-sect strong{font-size:12px;color:#6a7280}
    .hdr-sect pre{background:#f1f3f5;padding:8px;border-radius:4px;font-size:11px;font-family:ui-monospace,'SF Mono',Menlo,monospace;margin:4px 0 0;overflow:auto}
    table.net{width:100%;border-collapse:collapse;font-size:13px}
    table.net th{color:#6a7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:2px solid #e3e6eb;text-align:left}
    table.net td{padding:6px 8px;border-bottom:1px solid #e3e6eb;vertical-align:top}
    table.net tr.saml-row{background:rgba(51,103,214,.05)}
    .net-url{word-break:break-all}
    .status.ok{color:#1a7f37;font-weight:600}
    .status.redir{color:#9a6700;font-weight:600}
    .status.err{color:#c5221f;font-weight:600}
    @media print{.capture-card{break-inside:avoid}details{display:block}details summary{display:none}}
    @media(prefers-color-scheme:dark){
      body{background:#1d1f23;color:#e3e6eb}
      header{background:#25282d;border-color:#353a40}
      .capture-card{background:#25282d;border-color:#353a40}
      .htbl td,table.attrs th,table.attrs td,table.net th,table.net td{border-color:#353a40}
      table.attrs th{background:#2d3137}
      pre.xml,.hdr-sect pre{background:#2d3137;color:#e3e6eb}
      h2{border-color:#353a40}
    }`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SAML Trace Report — ${escape(nowStr)}</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <h1>SAML Trace Report</h1>
    <p>Generated: ${escape(nowStr)} &nbsp;|&nbsp; ${reportCaptures.length} SAML capture${reportCaptures.length !== 1 ? 's' : ''} &nbsp;|&nbsp; ${allNetwork.length} total request${allNetwork.length !== 1 ? 's' : ''}</p>
  </header>
  <main>
    ${reportCaptures.length ? `<h2>SAML Captures (${reportCaptures.length})</h2>${samlSections}` : '<p class="muted">No SAML captures in this trace.</p>'}
    ${allNetwork.length ? `
    <h2>Network Traffic (${allNetwork.length} request${allNetwork.length !== 1 ? 's' : ''})</h2>
    <table class="net">
      <thead><tr><th>Method</th><th>Status</th><th>URL</th><th>Time</th><th>Headers</th></tr></thead>
      <tbody>${networkRows}</tbody>
    </table>` : ''}
  </main>
</body>
</html>`;
}

async function generateHtmlReport() {
  if (!captures.length && !networkEntries.length) {
    statusEl.textContent = 'Nothing to report — no captures yet.';
    return;
  }
  const html = await buildHtmlString();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const filename = `SAML-Report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.html`;
  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    URL.revokeObjectURL(url);
    showReportBanner(downloadId, filename);
  });
}

let bannerDismissTimer = null;

function showReportBanner(downloadId, filename) {
  const banner = document.getElementById('report-banner');
  if (bannerDismissTimer) { clearTimeout(bannerDismissTimer); bannerDismissTimer = null; }
  banner.innerHTML = `
    <span class="report-banner-msg">Report saved: <strong>${escape(filename)}</strong></span>
    <button id="report-show-folder">Show in Folder</button>
    <button class="report-banner-dismiss" id="report-dismiss" title="Dismiss">${ICONS.x}</button>
  `;
  banner.classList.remove('hidden');
  document.getElementById('report-show-folder').addEventListener('click', () => {
    chrome.downloads.show(downloadId);
  });
  document.getElementById('report-dismiss').addEventListener('click', () => {
    banner.classList.add('hidden');
    if (bannerDismissTimer) { clearTimeout(bannerDismissTimer); bannerDismissTimer = null; }
  });
  bannerDismissTimer = setTimeout(() => {
    banner.classList.add('hidden');
    bannerDismissTimer = null;
  }, 8000);
}

function buildSamlCaptureText(c, s, xml, encoding, netEntry) {
  const what = c.samlResponse ? 'SAMLResponse' : 'SAMLRequest';
  const statusCode = netEntry?.statusCode ?? '';
  const time = new Date(c.timestamp).toLocaleString();
  const lines = [];
  lines.push(`${what}  ${c.method}${statusCode ? ' → ' + statusCode : ''}`);
  lines.push(c.url);
  lines.push(`Time:        ${time}`);
  if (s) {
    if (s.issuer)      lines.push(`Issuer:      ${s.issuer}`);
    if (s.subject)     lines.push(`Subject:     ${s.subject}`);
    if (s.status)      lines.push(`Status:      ${s.status}`);
    if (s.destination) lines.push(`Destination: ${s.destination}`);
    if (s.conditions) {
      lines.push(`Conditions:  ${s.conditions.notBefore || ''} → ${s.conditions.notOnOrAfter || ''}`);
      if (s.conditions.audience) lines.push(`Audience:    ${s.conditions.audience}`);
    }
    if (s.attributes?.length) {
      lines.push('');
      lines.push(`Attributes (${s.attributes.length}):`);
      for (const a of s.attributes) {
        const name = a.friendlyName || shortName(a.name);
        const vals = a.values.join(', ') || '(no values)';
        lines.push(`  ${name.padEnd(22)} ${vals}`);
      }
    }
  }
  if (netEntry?.requestHeaders?.length) {
    lines.push('');
    lines.push('Request Headers:');
    for (const h of netEntry.requestHeaders) lines.push(`  ${h.name}: ${h.value}`);
  }
  if (netEntry?.responseHeaders?.length) {
    lines.push('');
    lines.push('Response Headers:');
    for (const h of netEntry.responseHeaders) lines.push(`  ${h.name}: ${h.value}`);
  }
  if (xml) {
    lines.push('');
    lines.push('Raw XML:');
    prettyPrintXml(xml).split('\n').forEach(l => lines.push('  ' + l));
  }
  return lines.join('\n');
}

function buildNetworkEntryText(entry) {
  const time = new Date(entry.timestamp).toLocaleString();
  const lines = [];
  lines.push(`${entry.method}  ${entry.statusCode || ''}  ${entry.url}`);
  lines.push(`Time: ${time}`);
  if (entry.requestHeaders?.length) {
    lines.push('');
    lines.push('Request Headers:');
    for (const h of entry.requestHeaders) lines.push(`  ${h.name}: ${h.value}`);
  }
  if (entry.responseHeaders?.length) {
    lines.push('');
    lines.push('Response Headers:');
    for (const h of entry.responseHeaders) lines.push(`  ${h.name}: ${h.value}`);
  }
  return lines.join('\n');
}

function addCopyButton(getText) {
  const btn = document.createElement('button');
  btn.className = 'ghost detail-copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch (e) {
      statusEl.textContent = `Copy failed: ${e.message}`;
    }
  });
  detailEl.insertBefore(btn, detailEl.firstChild);
}

document.getElementById('kofi-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://ko-fi.com/samldev' });
});

document.getElementById('site-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://ast-web.pages.dev/' });
});

document.getElementById('share-report').addEventListener('click', generateHtmlReport);

document.getElementById('clear').addEventListener('click', async () => {
  if (!importedMode) await chrome.runtime.sendMessage({ type: 'clear-captures' });
  captures = [];
  networkEntries = [];
  selectedId = null;
  importedMode = false;
  statusEl.textContent = '';
  detailEl.innerHTML = '<p class="empty">Cleared.</p>';
  if (viewMode === 'saml') renderSamlList(); else renderNetworkList();
  syncErrorsButton();
});

document.getElementById('open-viewer').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await loadFile(file);
  e.target.value = '';
});

// --- JWT view ---

const jwtTokenEl = document.getElementById('jwt-token');
const jwtOutputEl = document.getElementById('jwt-output');

jwtTokenEl.addEventListener('input', renderJwt);

document.getElementById('jwt-paste').addEventListener('click', async () => {
  try {
    jwtTokenEl.value = (await navigator.clipboard.readText()).trim();
    renderJwt();
  } catch (e) {
    jwtOutputEl.innerHTML = `<p class="error">Clipboard read failed: ${escape(e.message)}</p>`;
  }
});

document.getElementById('jwt-clear').addEventListener('click', () => {
  jwtTokenEl.value = '';
  jwtOutputEl.innerHTML = '';
});

function renderJwt() {
  const token = jwtTokenEl.value.trim();
  if (!token) { jwtOutputEl.innerHTML = ''; return; }
  try {
    const { header, payload, signature, claims } = decodeJwt(token);
    jwtOutputEl.innerHTML = `
      <div class="jwt-grid">
        <section>
          <h2>Header</h2>
          <pre>${escape(JSON.stringify(header, null, 2))}</pre>
        </section>
        <section>
          <h2>Payload</h2>
          <pre>${escape(JSON.stringify(payload, null, 2))}</pre>
        </section>
        <section>
          <h2>Signature</h2>
          <pre class="muted">${escape(signature || '(none)')}</pre>
        </section>
      </div>
      ${renderJwtClaims(claims)}`;
  } catch (e) {
    jwtOutputEl.innerHTML = `<p class="error">${escape(e.message)}</p>`;
  }
}

function renderJwtClaims(c) {
  const items = Object.entries(c).filter(([, v]) => v != null && v !== '');
  if (!items.length) return '';
  const labels = {
    issuer: 'iss (Issuer)', subject: 'sub (Subject)', audience: 'aud (Audience)',
    issuedAt: 'iat (Issued at)', notBefore: 'nbf (Not before)', expiresAt: 'exp (Expires)',
    expiresIn: 'Expires in', expired: 'Expired', jwtId: 'jti (JWT ID)'
  };
  return `
    <section class="claims">
      <h2 style="margin:16px 0 8px;text-transform:uppercase;font-size:13px;letter-spacing:0.04em;color:var(--fg-muted);">Highlights</h2>
      <dl>
        ${items.map(([k, v]) =>
          `<dt>${escape(labels[k] || k)}</dt>
           <dd${k === 'expired' && v ? ' class="expired"' : ''}>${escape(String(v))}</dd>`
        ).join('')}
      </dl>
    </section>`;
}

// --- drag-and-drop import ---

let dragCounter = 0;
const dropOverlay = document.getElementById('drop-overlay');

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.remove('hidden');
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden'); }
});
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.add('hidden');
  const file = e.dataTransfer?.files[0];
  if (file) await loadFile(file);
});

async function loadFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    statusEl.textContent = 'Import failed: invalid JSON';
    return;
  }
  const reqs = data.requests;
  if (!Array.isArray(reqs)) {
    statusEl.textContent = 'Import failed: missing requests array';
    return;
  }

  networkEntries = reqs.map((r, i) => ({
    id: `net-${r.timestamp || i}-${r.requestId || i}`,
    requestId: String(r.requestId ?? i),
    timestamp: r.timestamp || 0,
    method: r.method || 'GET',
    url: r.url || '',
    type: r.type || 'main_frame',
    tabId: -1,
    statusCode: r.responseStatus ?? r.res?.statusCode ?? 0,
    statusLine: r.responseStatusText || r.res?.statusLine || '',
    requestHeaders: r.requestHeaders || [],
    responseHeaders: r.responseHeaders || r.res?.responseHeaders || [],
  }));

  captures = [];
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i];
    if (r.protocol !== 'SAML-P') continue;

    let samlRequest = null, samlResponse = null, relayState = null, source = 'form';

    if (Array.isArray(r.post)) {
      for (const [k, v] of r.post) {
        if (k === 'SAMLResponse') samlResponse = v;
        else if (k === 'SAMLRequest') samlRequest = v;
        else if (k === 'RelayState') relayState = v;
      }
      source = 'form';
    } else if (r.postData) {
      samlResponse = r.postData.SAMLResponse?.[0] ?? null;
      samlRequest = r.postData.SAMLRequest?.[0] ?? null;
      relayState = r.postData.RelayState?.[0] ?? null;
      source = 'form';
    }
    if (!samlRequest && !samlResponse && Array.isArray(r.get)) {
      for (const [k, v] of r.get) {
        if (k === 'SAMLResponse') samlResponse = v;
        else if (k === 'SAMLRequest') samlRequest = v;
        else if (k === 'RelayState') relayState = v;
      }
      source = 'url';
    }

    if (samlRequest || samlResponse) {
      captures.push({
        id: `${r.timestamp || i}-${r.requestId ?? i}`,
        requestId: String(r.requestId ?? i),
        timestamp: r.timestamp || 0,
        method: r.method || 'POST',
        url: r.url || '',
        type: r.type || 'main_frame',
        tabId: -1,
        source,
        samlRequest,
        samlResponse,
        relayState,
      });
    }
  }

  importedMode = true;
  const samlCount = captures.length;
  statusEl.textContent = `Imported: ${networkEntries.length} request${networkEntries.length !== 1 ? 's' : ''}${samlCount ? `, ${samlCount} SAML` : ''}`;
  syncErrorsButton();
  setView('network');
}

// --- live updates ---

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'set-view') { setView(msg.view); return; }
  if (importedMode) return;
  if (msg.type === 'capture-added' && viewMode === 'saml') refresh();
  if (msg.type === 'network-added' && (viewMode === 'network' || viewMode === 'errors')) refreshNetwork();
});

// --- helpers ---

function methodClass(m) { return 'method-' + (m || '').toLowerCase(); }
function matchesSearch(url, method, extra) {
  if (!searchQuery) return true;
  const q = searchQuery;
  return (url || '').toLowerCase().includes(q) ||
    (method || '').toLowerCase().includes(q) ||
    (extra || '').toLowerCase().includes(q);
}

initResizer(document.getElementById('resizer'), document.querySelector('.entry-pane'), 'popup-pane-width');

loadSettings().then(() => {
  const hash = location.hash.slice(1);
  if (hash === 'jwt') setView('jwt');
  else refresh();
});
