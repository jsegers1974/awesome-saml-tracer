import { decodeSamlMessage, summarizeSaml, prettyPrintXml } from '../shared/saml.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file');
const pickBtn = document.getElementById('pick');
const results = document.getElementById('results');

// Page-wide drag-and-drop, so the user doesn't have to aim at the box.
['dragenter', 'dragover'].forEach(ev => {
  document.addEventListener(ev, e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropzone.classList.add('hover');
  });
});
['dragleave', 'drop'].forEach(ev => {
  document.addEventListener(ev, e => {
    e.preventDefault();
    dropzone.classList.remove('hover');
  });
});
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

pickBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function hasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}

async function loadFile(file) {
  results.hidden = false;
  results.innerHTML = `<p class="muted">Loading <code>${escape(file.name)}</code>…</p>`;
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch (e) {
    results.innerHTML = `<p class="error">Could not parse file: ${escape(e.message)}</p>`;
    return;
  }
  const entries = normalizeEntries(data);
  await renderEntries(file.name, entries);
}

/**
 * Accept several plausible shapes:
 *  - the SAML-tracer extension export ({ requests: [...] })
 *  - array of entry objects
 *  - { entries: [...] } / { captures: [...] }
 *  - a single entry object
 */
function normalizeEntries(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.requests)) return data.requests;
  if (data && Array.isArray(data.entries)) return data.entries;
  if (data && Array.isArray(data.captures)) return data.captures;
  if (data && typeof data === 'object') return [data];
  return [];
}

async function renderEntries(filename, entries) {
  results.innerHTML = '';
  const samlEntries = [];
  for (const e of entries) {
    const payload = extractSamlPayload(e);
    if (payload) samlEntries.push({ entry: e, payload });
  }

  const bar = document.createElement('div');
  bar.className = 'summary-bar';
  bar.innerHTML = `<code>${escape(filename)}</code> — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'},
    ${samlEntries.length} SAML message${samlEntries.length === 1 ? '' : 's'}.`;
  results.appendChild(bar);

  if (!samlEntries.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No SAML messages found in this file.';
    results.appendChild(p);
    return;
  }

  for (const { entry, payload } of samlEntries) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = '<p class="muted">Decoding…</p>';
    results.appendChild(card);
    try {
      let xml, encoding;
      if (payload.isXml) {
        xml = payload.value;
        encoding = 'pre-decoded';
      } else {
        ({ xml, encoding } = await decodeSamlMessage(payload.value));
      }
      const summary = summarizeSaml(xml);
      card.innerHTML = renderCard(entry, payload, summary, xml, encoding);
    } catch (err) {
      card.innerHTML = `<p class="error">Decode failed: ${escape(err.message)}</p>`;
    }
  }
}

function extractSamlPayload(entry) {
  // SAML-tracer exports store already-decoded XML in entry.saml.
  if (entry.saml && typeof entry.saml === 'string') {
    const kind = entry.saml.includes('SAMLResponse') || entry.saml.includes('Response') ? 'SAMLResponse' : 'SAMLRequest';
    return { kind, value: entry.saml, source: 'saml-tracer', isXml: true };
  }

  const url = entry.url || entry.requestUrl || '';
  try {
    const u = new URL(url);
    if (u.searchParams.get('SAMLResponse')) return { kind: 'SAMLResponse', value: u.searchParams.get('SAMLResponse'), source: 'url' };
    if (u.searchParams.get('SAMLRequest')) return { kind: 'SAMLRequest', value: u.searchParams.get('SAMLRequest'), source: 'url' };
  } catch (_) { /* ignore */ }

  // SAML-tracer: postData is an object with arrays of values { SAMLResponse: ["..."] }
  const postData = entry.postData;
  if (postData && typeof postData === 'object' && !Array.isArray(postData)) {
    const resp = Array.isArray(postData.SAMLResponse) ? postData.SAMLResponse[0] : postData.SAMLResponse;
    const req = Array.isArray(postData.SAMLRequest) ? postData.SAMLRequest[0] : postData.SAMLRequest;
    if (resp) return { kind: 'SAMLResponse', value: resp, source: 'post' };
    if (req) return { kind: 'SAMLRequest', value: req, source: 'post' };
  }

  const post = entry.post || entry.requestBody || entry.body;
  // SAML-tracer: post is an array of [key, value] pairs
  if (Array.isArray(post)) {
    const resp = post.find(p => p[0] === 'SAMLResponse');
    const req = post.find(p => p[0] === 'SAMLRequest');
    if (resp?.[1]) return { kind: 'SAMLResponse', value: resp[1], source: 'post' };
    if (req?.[1]) return { kind: 'SAMLRequest', value: req[1], source: 'post' };
  }
  if (typeof post === 'string') {
    const params = new URLSearchParams(post);
    if (params.get('SAMLResponse')) return { kind: 'SAMLResponse', value: params.get('SAMLResponse'), source: 'post' };
    if (params.get('SAMLRequest')) return { kind: 'SAMLRequest', value: params.get('SAMLRequest'), source: 'post' };
  }
  if (entry.samlResponse) return { kind: 'SAMLResponse', value: entry.samlResponse, source: 'field' };
  if (entry.samlRequest) return { kind: 'SAMLRequest', value: entry.samlRequest, source: 'field' };
  return null;
}

function renderCard(entry, payload, s, xml, encoding) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
  const url = entry.url || entry.requestUrl || '';
  const head = `
    <div class="detail-head">
      <h2>${escape(s.kind || payload.kind)} <span class="muted" style="font-weight:400;font-size:12px;">${escape(payload.source)}</span></h2>
      <dl>
        ${row('Time', time)}
        ${row('URL', url)}
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
    <dl class="detail-head" style="display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin-bottom:12px;">
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
    <h3>Attributes (${attrs.length})</h3>
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
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
