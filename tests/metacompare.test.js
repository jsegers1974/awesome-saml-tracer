import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { metaCompare } from '../shared/metacompare.js';

// Parsed-metadata shape (as parseMetadata would return) for an IdP+SP federation.
const META = {
  entities: [
    {
      entityID: 'https://idp.example.com',
      idp: {
        signingCerts: ['MIIDsignCERT=='],
        encryptionCerts: [],
        nameIdFormats: ['urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
        ssoServices: [],
      },
    },
    {
      entityID: 'https://sp.example.com',
      sp: {
        signingCerts: [],
        encryptionCerts: [],
        nameIdFormats: [],
        acs: [{ index: '0', binding: 'POST', location: 'https://sp.example.com/acs', isDefault: true }],
        requestedAttributes: [
          { name: 'urn:oid:email', friendlyName: 'email', isRequired: true },
          { name: 'urn:oid:given', friendlyName: 'givenName', isRequired: false },
        ],
      },
    },
  ],
};

// A fully-matching assertion (as summarizeSaml would now return).
const GOOD = {
  issuer: 'https://idp.example.com',
  destination: 'https://sp.example.com/acs',
  recipient: 'https://sp.example.com/acs',
  audiences: ['https://sp.example.com'],
  nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  signingCert: 'MIIDsignCERT==',
  attributes: [{ name: 'urn:oid:email', values: ['a@b.com'] }],
};

const byId = (result, id) => result.checks.find(c => c.id === id);

describe('metaCompare — all good', () => {
  test('every evaluated check matches', () => {
    const r = metaCompare(GOOD, META);
    assert.equal(r.summary.mismatches, 0);
    assert.equal(byId(r, 'issuer').status, 'match');
    assert.equal(byId(r, 'audience').status, 'match');
    assert.equal(byId(r, 'acs-recipient').status, 'match');
    assert.equal(byId(r, 'signing-cert').status, 'match');
    assert.equal(byId(r, 'nameid-format').status, 'match');
    assert.equal(byId(r, 'required-attributes').status, 'match');
  });
});

describe('metaCompare — individual mismatches', () => {
  test('issuer mismatch', () => {
    const r = metaCompare({ ...GOOD, issuer: 'https://evil.example.com' }, META);
    assert.equal(byId(r, 'issuer').status, 'mismatch');
    assert.equal(byId(r, 'issuer').expected, 'https://idp.example.com');
    assert.equal(byId(r, 'issuer').actual, 'https://evil.example.com');
    assert.ok(byId(r, 'issuer').hint);
  });

  test('audience mismatch', () => {
    const r = metaCompare({ ...GOOD, audiences: ['https://wrong.example.com'] }, META);
    assert.equal(byId(r, 'audience').status, 'mismatch');
  });

  test('ACS/recipient mismatch', () => {
    const r = metaCompare({ ...GOOD, recipient: 'https://sp.example.com/WRONG', destination: 'https://sp.example.com/WRONG' }, META);
    assert.equal(byId(r, 'acs-recipient').status, 'mismatch');
  });

  test('signing-cert mismatch (rotation)', () => {
    const r = metaCompare({ ...GOOD, signingCert: 'MIIDoldROTATEDcert==' }, META);
    assert.equal(byId(r, 'signing-cert').status, 'mismatch');
    assert.match(byId(r, 'signing-cert').hint, /rotat/i);
  });

  test('NameID format mismatch', () => {
    const r = metaCompare({ ...GOOD, nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' }, META);
    assert.equal(byId(r, 'nameid-format').status, 'mismatch');
  });

  test('missing required attribute', () => {
    const r = metaCompare({ ...GOOD, attributes: [{ name: 'urn:oid:given', values: ['x'] }] }, META);
    assert.equal(byId(r, 'required-attributes').status, 'mismatch');
    assert.match(byId(r, 'required-attributes').actual, /missing: email/);
  });
});

describe('metaCompare — partial metadata yields unknown, not false failures', () => {
  test('SP-only metadata: IdP checks are unknown', () => {
    const spOnly = { entities: [META.entities[1]] };
    const r = metaCompare(GOOD, spOnly);
    assert.equal(byId(r, 'issuer').status, 'unknown');
    assert.equal(byId(r, 'signing-cert').status, 'unknown');
    assert.equal(byId(r, 'audience').status, 'match'); // SP present
  });

  test('tolerant entityID matching (trailing slash / case)', () => {
    const r = metaCompare({ ...GOOD, issuer: 'https://IDP.example.com/' }, META);
    assert.equal(byId(r, 'issuer').status, 'match');
  });

  test('unsigned assertion: signing-cert is unknown, not mismatch', () => {
    const r = metaCompare({ ...GOOD, signingCert: null }, META);
    assert.equal(byId(r, 'signing-cert').status, 'unknown');
  });
});
