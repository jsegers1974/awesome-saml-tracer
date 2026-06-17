// MetaCompare rule engine. Compares a captured assertion (summarizeSaml facts)
// against parsed SAML metadata (parseMetadata) and reports per-rule results so
// engineers can see why an SSO isn't working. Pure — no DOM, no I/O.
//
// Each check: { id, label, expected, actual, status, hint }
//   status: 'match' | 'mismatch' | 'missing' | 'unknown'
// 'unknown' = couldn't evaluate (e.g. the relevant metadata/assertion field is
// absent); never reported as a failure.

const normId = (s) => (s || '').trim().replace(/\/+$/, '').toLowerCase();
const idEq = (a, b) => !!a && !!b && normId(a) === normId(b);
const urlEq = (a, b) => !!a && !!b && (a === b || a.replace(/\/+$/, '') === b.replace(/\/+$/, ''));

function check(id, label, status, expected, actual, hint) {
  return { id, label, status, expected: expected ?? null, actual: actual ?? null, hint: hint || null };
}

/**
 * @param {object} a  assertion facts from summarizeSaml
 * @param {{entities: Array}} metadata  from parseMetadata
 * @returns {{checks: Array, summary: {matches, mismatches, missing, unknown}}}
 */
export function metaCompare(a, metadata) {
  const entities = metadata?.entities || [];
  const audiences = a?.audiences || [];

  // Pick the IdP entity by issuer (else any IdP), SP entity by audience (else any SP).
  const idp = entities.find(e => e.idp && idEq(e.entityID, a?.issuer))
           || entities.find(e => e.idp) || null;
  const sp = entities.find(e => e.sp && audiences.some(aud => idEq(e.entityID, aud)))
          || entities.find(e => e.sp) || null;

  const checks = [];

  // 1. Issuer ↔ IdP entityID
  if (!idp) {
    checks.push(check('issuer', 'Issuer', 'unknown', null, a?.issuer, 'No IdP metadata provided.'));
  } else {
    checks.push(check('issuer', 'Issuer',
      idEq(idp.entityID, a?.issuer) ? 'match' : 'mismatch',
      idp.entityID, a?.issuer,
      "The assertion's Issuer doesn't match the IdP entityID in metadata — the IdP may be configured with a different entity ID."));
  }

  // 2. Audience ↔ SP entityID
  if (!sp) {
    checks.push(check('audience', 'Audience', 'unknown', null, audiences.join(', '), 'No SP metadata provided.'));
  } else if (!audiences.length) {
    checks.push(check('audience', 'Audience', 'missing', sp.entityID, null, 'The assertion has no AudienceRestriction.'));
  } else {
    checks.push(check('audience', 'Audience',
      audiences.some(aud => idEq(aud, sp.entityID)) ? 'match' : 'mismatch',
      sp.entityID, audiences.join(', '),
      "The assertion's Audience doesn't match the SP entityID — a common IdP audience misconfiguration."));
  }

  // 3. ACS / Recipient ↔ SP AssertionConsumerService URLs
  const acsLocations = (sp?.sp?.acs || []).map(x => x.location).filter(Boolean);
  const actualAcs = a?.recipient || a?.destination || null;
  if (!sp || !acsLocations.length) {
    checks.push(check('acs-recipient', 'ACS / Recipient', 'unknown', null, actualAcs, 'No SP ACS endpoints in metadata.'));
  } else if (!actualAcs) {
    checks.push(check('acs-recipient', 'ACS / Recipient', 'missing', acsLocations.join(', '), null, 'No Destination/Recipient in the assertion.'));
  } else {
    checks.push(check('acs-recipient', 'ACS / Recipient',
      acsLocations.some(loc => urlEq(loc, actualAcs)) ? 'match' : 'mismatch',
      acsLocations.join(', '), actualAcs,
      "The assertion's Recipient/Destination isn't one of the SP's ACS URLs — the IdP may be posting to the wrong endpoint."));
  }

  // 4. Signing certificate ↔ IdP signing certs (catches rotation/expiry)
  const idpSigning = idp?.idp?.signingCerts || [];
  if (!a?.signingCert) {
    checks.push(check('signing-cert', 'Signing certificate', 'unknown', null, null, 'The assertion has no embedded signing certificate to compare.'));
  } else if (!idpSigning.length) {
    checks.push(check('signing-cert', 'Signing certificate', 'unknown', null, fingerprintHint(a.signingCert), 'No IdP signing certificate in metadata.'));
  } else {
    checks.push(check('signing-cert', 'Signing certificate',
      idpSigning.includes(a.signingCert) ? 'match' : 'mismatch',
      `${idpSigning.length} cert(s) in metadata`, fingerprintHint(a.signingCert),
      "The certificate that signed the assertion isn't in the IdP metadata — most often a certificate rotation or expiry mismatch."));
  }

  // 5. NameID Format ↔ declared formats
  const declaredFormats = [...(idp?.idp?.nameIdFormats || []), ...(sp?.sp?.nameIdFormats || [])];
  if (!a?.nameIdFormat || !declaredFormats.length) {
    checks.push(check('nameid-format', 'NameID Format', 'unknown', declaredFormats.join(', ') || null, a?.nameIdFormat, 'No NameIDFormat declared in metadata.'));
  } else {
    checks.push(check('nameid-format', 'NameID Format',
      declaredFormats.includes(a.nameIdFormat) ? 'match' : 'mismatch',
      declaredFormats.join(', '), a.nameIdFormat,
      "The assertion's NameID Format isn't one the metadata declares support for."));
  }

  // 6. Required attributes present
  const required = (sp?.sp?.requestedAttributes || []).filter(r => r.isRequired);
  if (!sp) {
    checks.push(check('required-attributes', 'Required attributes', 'unknown', null, null, 'No SP metadata provided.'));
  } else if (!required.length) {
    checks.push(check('required-attributes', 'Required attributes', 'match', 'none required', 'n/a', null));
  } else {
    const present = new Set((a?.attributes || []).map(x => x.name));
    const missing = required.filter(r => !present.has(r.name)).map(r => r.friendlyName || r.name);
    checks.push(check('required-attributes', 'Required attributes',
      missing.length ? 'mismatch' : 'match',
      required.map(r => r.friendlyName || r.name).join(', '),
      missing.length ? `missing: ${missing.join(', ')}` : 'all present',
      "The SP requires attributes the assertion doesn't contain — a top cause of 'authenticated but access denied'."));
  }

  const summary = { matches: 0, mismatches: 0, missing: 0, unknown: 0 };
  for (const c of checks) {
    if (c.status === 'match') summary.matches++;
    else if (c.status === 'mismatch') summary.mismatches++;
    else if (c.status === 'missing') summary.missing++;
    else summary.unknown++;
  }
  return { checks, summary };
}

// Short, readable cert identifier for display (we don't compute a real
// fingerprint here — that needs a crypto digest; show a truncated head).
function fingerprintHint(certB64) {
  return certB64 ? `${certB64.slice(0, 16)}… (${certB64.length} chars)` : null;
}
