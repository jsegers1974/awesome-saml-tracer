import { decodeJwt } from '../shared/jwt.js';

const tokenEl = document.getElementById('token');
const output = document.getElementById('output');

tokenEl.addEventListener('input', render);
document.getElementById('clear').addEventListener('click', () => {
  tokenEl.value = '';
  output.hidden = true;
  tokenEl.focus();
});
document.getElementById('paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    tokenEl.value = text.trim();
    render();
  } catch (e) {
    output.hidden = false;
    output.innerHTML = `<p class="error">Clipboard read failed: ${escape(e.message)}</p>`;
  }
});

function render() {
  const token = tokenEl.value.trim();
  if (!token) { output.hidden = true; return; }
  output.hidden = false;
  try {
    const { header, payload, signature, claims } = decodeJwt(token);
    output.innerHTML = `
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
      ${renderClaims(claims)}
    `;
  } catch (e) {
    output.innerHTML = `<p class="error">${escape(e.message)}</p>`;
  }
}

function renderClaims(c) {
  const items = Object.entries(c).filter(([_, v]) => v != null && v !== '');
  if (!items.length) return '';
  return `
    <section class="claims">
      <h2 style="margin:0 0 8px;text-transform:uppercase;font-size:13px;letter-spacing:0.04em;color:var(--fg-muted);">Highlights</h2>
      <dl>
        ${items.map(([k, v]) => `
          <dt>${escape(humanLabel(k))}</dt>
          <dd${k === 'expired' && v ? ' class="expired"' : ''}>${escape(String(v))}</dd>
        `).join('')}
      </dl>
    </section>`;
}

function humanLabel(k) {
  return ({
    issuer: 'iss (Issuer)',
    subject: 'sub (Subject)',
    audience: 'aud (Audience)',
    issuedAt: 'iat (Issued at)',
    notBefore: 'nbf (Not before)',
    expiresAt: 'exp (Expires)',
    expiresIn: 'Expires in',
    expired: 'Expired',
    jwtId: 'jti (JWT ID)'
  }[k]) || k;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
