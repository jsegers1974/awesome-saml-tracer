// SAML decoding helpers. Pure ES module — works in service worker, devtools panel, and full pages.

/**
 * Decode a SAML message from its on-the-wire form.
 * Handles base64 (POST binding) and base64 + raw deflate (Redirect binding).
 * Tolerates URL-encoding and base64url variants.
 */
export async function decodeSamlMessage(encoded) {
  if (!encoded) throw new Error('Empty SAML payload');
  let s = String(encoded).trim();
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try { s = decodeURIComponent(s); } catch (_) { /* ignore */ }
  }
  const bytes = base64ToBytes(s);

  // Try the bytes as raw UTF-8 first (POST binding is base64 of the XML directly).
  const direct = bytesToUtf8(bytes);
  if (looksLikeXml(direct)) return { xml: direct, encoding: 'base64' };

  // Otherwise try inflating (Redirect binding).
  try {
    const inflated = await inflateRaw(bytes);
    if (looksLikeXml(inflated)) return { xml: inflated, encoding: 'base64+deflate' };
  } catch (_) { /* fall through */ }

  // Last resort — return whatever we got so the user can still see it.
  return { xml: direct, encoding: 'unknown' };
}

/** Parse SAML XML and pull out a structured summary. */
export function summarizeSaml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || root.getElementsByTagName('parsererror').length) {
    return { kind: 'unknown', error: 'Failed to parse XML' };
  }
  const ns = {
    samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
    saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
    ds: 'http://www.w3.org/2000/09/xmldsig#'
  };
  const first = (parent, uri, local) => {
    const list = parent.getElementsByTagNameNS(uri, local);
    return list.length ? list[0] : null;
  };
  const all = (parent, uri, local) => Array.from(parent.getElementsByTagNameNS(uri, local));

  const issuer = first(root, ns.saml, 'Issuer')?.textContent?.trim() || null;
  const destination = root.getAttribute('Destination') || null;
  const id = root.getAttribute('ID') || null;
  const issueInstant = root.getAttribute('IssueInstant') || null;
  const status = first(root, ns.samlp, 'StatusCode')?.getAttribute('Value') || null;
  const subjectEl = first(root, ns.saml, 'Subject');
  const nameIdEl = subjectEl ? first(subjectEl, ns.saml, 'NameID') : null;
  const subject = nameIdEl?.textContent?.trim() || null;
  const nameIdFormat = nameIdEl?.getAttribute('Format') || null;
  const recipient = subjectEl
    ? first(subjectEl, ns.saml, 'SubjectConfirmationData')?.getAttribute('Recipient') || null
    : null;

  // All audiences (conditions.audience below keeps the first for back-compat).
  const audiences = all(root, ns.saml, 'Audience')
    .map(a => a.textContent?.trim())
    .filter(Boolean);

  // The certificate embedded in the signature (whitespace stripped). Used to
  // match against IdP metadata. Not a cryptographic signature verification.
  const certEl = first(root, ns.ds, 'X509Certificate');
  const signingCert = certEl ? certEl.textContent.replace(/\s+/g, '') || null : null;

  const attributes = all(root, ns.saml, 'Attribute').map(el => ({
    name: el.getAttribute('Name'),
    friendlyName: el.getAttribute('FriendlyName') || null,
    nameFormat: el.getAttribute('NameFormat') || null,
    values: all(el, ns.saml, 'AttributeValue')
      .map(v => v.textContent?.trim())
      .filter(v => v != null && v !== '')
  }));

  // Detection uses string search as the primary method — getElementsByTagNameNS
  // with namespace wildcards is unreliable in Chrome extension contexts.
  const xenc = 'http://www.w3.org/2001/04/xmlenc#';
  const assertionEncrypted =
    xml.includes('EncryptedAssertion') ||
    root.localName === 'EncryptedAssertion' ||
    root.getElementsByTagNameNS('*', 'EncryptedAssertion').length > 0 ||
    root.getElementsByTagNameNS(xenc, 'EncryptedData').length > 0;
  const encryptedAttributeCount =
    root.getElementsByTagNameNS('*', 'EncryptedAttribute').length;

  const conditionsEl = first(root, ns.saml, 'Conditions');
  const conditions = conditionsEl ? {
    notBefore: conditionsEl.getAttribute('NotBefore'),
    notOnOrAfter: conditionsEl.getAttribute('NotOnOrAfter'),
    audience: first(conditionsEl, ns.saml, 'Audience')?.textContent?.trim() || null
  } : null;

  return {
    kind: root.localName,
    id,
    issueInstant,
    issuer,
    destination,
    status,
    subject,
    nameIdFormat,
    recipient,
    audiences,
    signingCert,
    assertionEncrypted,
    encryptedAttributeCount,
    attributes,
    conditions
  };
}

/** Tiny XML pretty-printer — no external deps. */
export function prettyPrintXml(xml) {
  const PAD = '  ';
  let out = '';
  let depth = 0;
  const compact = String(xml).replace(/>\s*</g, '><').trim();
  compact.split(/(?=<)/).forEach(node => {
    if (!node) return;
    let nextDelta = 0;
    if (/^<\/[^>]+>/.test(node)) {
      depth = Math.max(depth - 1, 0);
    } else if (/^<[^!?][^>]*[^/]>$/.test(node) && !/^<[^>]+\/>$/.test(node)) {
      nextDelta = 1;
    }
    out += PAD.repeat(depth) + node + '\n';
    depth += nextDelta;
  });
  return out.trimEnd();
}

// --- internal helpers ---

function looksLikeXml(s) {
  return typeof s === 'string' && /^\s*<\?xml|^\s*<[A-Za-z]/.test(s);
}

function base64ToBytes(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
}
