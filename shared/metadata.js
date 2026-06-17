// SAML 2.0 metadata parser for MetaCompare. Pure (DOMParser only) — parses an
// EntityDescriptor or an EntitiesDescriptor (federation file) into structured
// facts the compare engine checks the captured assertion against.

const NS = {
  md: 'urn:oasis:names:tc:SAML:2.0:metadata',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
};

const all = (parent, uri, local) => Array.from(parent.getElementsByTagNameNS(uri, local));
const first = (parent, uri, local) => {
  const list = parent.getElementsByTagNameNS(uri, local);
  return list.length ? list[0] : null;
};

// Certs from a role descriptor's KeyDescriptors matching `use`
// ('signing'/'encryption'); a KeyDescriptor with no use attribute counts as both.
function certsFor(descEl, use) {
  const out = [];
  for (const kd of all(descEl, NS.md, 'KeyDescriptor')) {
    const u = kd.getAttribute('use');
    if (u && u !== use) continue;
    for (const c of all(kd, NS.ds, 'X509Certificate')) {
      const v = c.textContent.replace(/\s+/g, '');
      if (v) out.push(v);
    }
  }
  return out;
}

const nameIdFormats = (descEl) =>
  all(descEl, NS.md, 'NameIDFormat').map(n => n.textContent.trim()).filter(Boolean);

function parseIdp(descEl) {
  return {
    signingCerts: certsFor(descEl, 'signing'),
    encryptionCerts: certsFor(descEl, 'encryption'),
    nameIdFormats: nameIdFormats(descEl),
    ssoServices: all(descEl, NS.md, 'SingleSignOnService').map(s => ({
      binding: s.getAttribute('Binding'),
      location: s.getAttribute('Location'),
    })),
  };
}

function parseSp(descEl) {
  return {
    signingCerts: certsFor(descEl, 'signing'),
    encryptionCerts: certsFor(descEl, 'encryption'),
    nameIdFormats: nameIdFormats(descEl),
    acs: all(descEl, NS.md, 'AssertionConsumerService').map(a => ({
      index: a.getAttribute('index'),
      binding: a.getAttribute('Binding'),
      location: a.getAttribute('Location'),
      isDefault: a.getAttribute('isDefault') === 'true',
    })),
    requestedAttributes: all(descEl, NS.md, 'RequestedAttribute').map(r => ({
      name: r.getAttribute('Name'),
      friendlyName: r.getAttribute('FriendlyName') || null,
      isRequired: r.getAttribute('isRequired') === 'true',
    })),
  };
}

/**
 * Parse SAML metadata XML.
 * @returns {{entities: Array<{entityID, idp?, sp?}>, error?: string}}
 */
export function parseMetadata(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || root.getElementsByTagName('parsererror').length) {
    return { entities: [], error: 'Failed to parse metadata XML' };
  }
  // A bare EntityDescriptor is the root itself; a federation file wraps many.
  const entityEls = root.localName === 'EntityDescriptor'
    ? [root]
    : all(root, NS.md, 'EntityDescriptor');

  const entities = entityEls.map(el => {
    const entity = { entityID: el.getAttribute('entityID') };
    const idpEl = first(el, NS.md, 'IDPSSODescriptor');
    const spEl = first(el, NS.md, 'SPSSODescriptor');
    if (idpEl) entity.idp = parseIdp(idpEl);
    if (spEl) entity.sp = parseSp(spEl);
    return entity;
  });
  return { entities };
}

const normId = (s) => (s || '').trim().replace(/\/+$/, '').toLowerCase();

/** Find an entity by entityID — exact first, then tolerant of trailing slash / case. */
export function findEntity(parsed, entityID) {
  if (!entityID) return null;
  const entities = parsed?.entities || [];
  const exact = entities.find(e => e.entityID === entityID);
  if (exact) return exact;
  const target = normId(entityID);
  return entities.find(e => normId(e.entityID) === target) || null;
}
