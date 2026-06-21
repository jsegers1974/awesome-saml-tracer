import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

before(() => {
  const { window } = new JSDOM('');
  globalThis.DOMParser = window.DOMParser;
});

const { parseMetadata, findEntity } = await import('../shared/metadata.js');

const IDP_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  entityID="https://idp.example.com/saml">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>
        MIIDsign
        CERT==
      </ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="encryption">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>MIIDencCERT==</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

const SP_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  entityID="https://sp.example.com">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor><!-- no use = both -->
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>MIIDspCERT==</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService index="0" isDefault="true"
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://sp.example.com/acs"/>
    <md:AssertionConsumerService index="1"
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Artifact" Location="https://sp.example.com/acs2"/>
    <md:AttributeConsumingService index="0">
      <md:RequestedAttribute Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="email" isRequired="true"/>
      <md:RequestedAttribute Name="urn:oid:2.5.4.42" FriendlyName="givenName"/>
    </md:AttributeConsumingService>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

const FEDERATION = `<?xml version="1.0"?>
<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata">
  ${IDP_METADATA.replace(/<\?xml.*\?>/, '')}
  ${SP_METADATA.replace(/<\?xml.*\?>/, '')}
</md:EntitiesDescriptor>`;

describe('parseMetadata — IdP', () => {
  let idp;
  before(() => { idp = parseMetadata(IDP_METADATA).entities[0]; });

  test('reads entityID', () => {
    assert.equal(idp.entityID, 'https://idp.example.com/saml');
  });
  test('extracts signing cert (whitespace stripped)', () => {
    assert.deepEqual(idp.idp.signingCerts, ['MIIDsignCERT==']);
  });
  test('separates encryption cert', () => {
    assert.deepEqual(idp.idp.encryptionCerts, ['MIIDencCERT==']);
  });
  test('reads NameIDFormat and SSO service', () => {
    assert.deepEqual(idp.idp.nameIdFormats, ['urn:oasis:names:tc:SAML:2.0:nameid-format:persistent']);
    assert.equal(idp.idp.ssoServices[0].location, 'https://idp.example.com/sso');
  });
  test('has no sp descriptor', () => {
    assert.equal(idp.sp, undefined);
  });
});

describe('parseMetadata — SP', () => {
  let sp;
  before(() => { sp = parseMetadata(SP_METADATA).entities[0]; });

  test('lists all ACS endpoints with index/binding/default', () => {
    assert.equal(sp.sp.acs.length, 2);
    assert.equal(sp.sp.acs[0].location, 'https://sp.example.com/acs');
    assert.equal(sp.sp.acs[0].isDefault, true);
    assert.equal(sp.sp.acs[1].isDefault, false);
  });
  test('a KeyDescriptor with no use counts as both signing and encryption', () => {
    assert.deepEqual(sp.sp.signingCerts, ['MIIDspCERT==']);
    assert.deepEqual(sp.sp.encryptionCerts, ['MIIDspCERT==']);
  });
  test('reads RequestedAttributes with isRequired', () => {
    assert.equal(sp.sp.requestedAttributes.length, 2);
    const email = sp.sp.requestedAttributes.find(a => a.friendlyName === 'email');
    assert.equal(email.name, 'urn:oid:0.9.2342.19200300.100.1.3');
    assert.equal(email.isRequired, true);
    const given = sp.sp.requestedAttributes.find(a => a.friendlyName === 'givenName');
    assert.equal(given.isRequired, false);
  });
});

describe('parseMetadata — EntitiesDescriptor (federation)', () => {
  test('parses both entities', () => {
    const { entities } = parseMetadata(FEDERATION);
    assert.equal(entities.length, 2);
    assert.ok(entities.some(e => e.idp));
    assert.ok(entities.some(e => e.sp));
  });
});

describe('parseMetadata — errors', () => {
  test('returns empty entities + error on garbage', () => {
    const r = parseMetadata('not xml <<<');
    assert.deepEqual(r.entities, []);
    assert.ok(r.error);
  });
});

describe('findEntity', () => {
  let parsed;
  before(() => { parsed = parseMetadata(FEDERATION); });

  test('exact match', () => {
    assert.equal(findEntity(parsed, 'https://sp.example.com').entityID, 'https://sp.example.com');
  });
  test('tolerant of trailing slash / case', () => {
    assert.equal(findEntity(parsed, 'https://SP.example.com/').entityID, 'https://sp.example.com');
  });
  test('null when not found or no id', () => {
    assert.equal(findEntity(parsed, 'https://other.com'), null);
    assert.equal(findEntity(parsed, ''), null);
  });
});
