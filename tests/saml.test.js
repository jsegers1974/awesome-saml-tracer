import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { decodeSamlMessage, summarizeSaml, prettyPrintXml } from '../shared/saml.js';

const deflateRaw = promisify(zlib.deflateRaw);

// Polyfill DOMParser from jsdom so summarizeSaml works outside the browser
before(() => {
  const { window } = new JSDOM('');
  globalThis.DOMParser = window.DOMParser;
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAML_RESPONSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="_response1" Version="2.0"
  IssueInstant="2024-01-01T00:00:00Z"
  Destination="https://sp.example.com/acs">
  <saml:Issuer>https://idp.example.com</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  <saml:Assertion ID="_assert1" Version="2.0" IssueInstant="2024-01-01T00:00:00Z">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">user@example.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotBefore="2024-01-01T00:00:00Z" NotOnOrAfter="2024-01-01T01:00:00Z">
      <saml:AudienceRestriction>
        <saml:Audience>https://sp.example.com</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="urn:oid:1.3.6.1.4.1.5923.1.1.1.7" FriendlyName="eduPersonEntitlement">
        <saml:AttributeValue>member</saml:AttributeValue>
        <saml:AttributeValue>admin</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="urn:oid:1.2.840.113549.1.9.1" FriendlyName="email">
        <saml:AttributeValue>user@example.com</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

const AUTHN_REQUEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="_request1" Version="2.0"
  IssueInstant="2024-01-01T00:00:00Z"
  Destination="https://idp.example.com/sso">
  <saml:Issuer>https://sp.example.com</saml:Issuer>
</samlp:AuthnRequest>`;

const POST_ENCODED    = Buffer.from(SAML_RESPONSE_XML).toString('base64');
const URLENC_ENCODED  = encodeURIComponent(POST_ENCODED);

// ---------------------------------------------------------------------------
// decodeSamlMessage
// ---------------------------------------------------------------------------

describe('decodeSamlMessage', () => {

  test('throws on empty input', async () => {
    await assert.rejects(() => decodeSamlMessage(''), /empty/i);
  });

  test('throws on null', async () => {
    await assert.rejects(() => decodeSamlMessage(null), /empty/i);
  });

  describe('POST binding (base64)', () => {
    test('decodes base64-encoded XML', async () => {
      const { xml, encoding } = await decodeSamlMessage(POST_ENCODED);
      assert.ok(xml.includes('<samlp:Response'));
      assert.equal(encoding, 'base64');
    });

    test('strips whitespace from encoded input', async () => {
      const withSpaces = POST_ENCODED.replace(/.{60}/g, '$&\n');
      const { xml } = await decodeSamlMessage(withSpaces);
      assert.ok(xml.includes('<samlp:Response'));
    });

    test('handles URL-encoded base64', async () => {
      const { xml, encoding } = await decodeSamlMessage(URLENC_ENCODED);
      assert.ok(xml.includes('<samlp:Response'));
      assert.equal(encoding, 'base64');
    });

    test('handles base64url variant (- and _ characters)', async () => {
      const b64url = POST_ENCODED.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const { xml } = await decodeSamlMessage(b64url);
      assert.ok(xml.includes('<samlp:Response'));
    });
  });

  describe('Redirect binding (base64 + deflate)', () => {
    test('decodes deflate-compressed XML', async () => {
      const compressed = await deflateRaw(SAML_RESPONSE_XML);
      const encoded = compressed.toString('base64');
      const { xml, encoding } = await decodeSamlMessage(encoded);
      assert.ok(xml.includes('<samlp:Response'));
      assert.equal(encoding, 'base64+deflate');
    });

    test('decodes an AuthnRequest via redirect binding', async () => {
      const compressed = await deflateRaw(AUTHN_REQUEST_XML);
      const encoded = compressed.toString('base64');
      const { xml, encoding } = await decodeSamlMessage(encoded);
      assert.ok(xml.includes('<samlp:AuthnRequest'));
      assert.equal(encoding, 'base64+deflate');
    });
  });

  describe('returned XML', () => {
    test('returned XML contains the issuer', async () => {
      const { xml } = await decodeSamlMessage(POST_ENCODED);
      assert.ok(xml.includes('https://idp.example.com'));
    });

    test('returned XML contains attributes', async () => {
      const { xml } = await decodeSamlMessage(POST_ENCODED);
      assert.ok(xml.includes('eduPersonEntitlement'));
    });
  });

});

// ---------------------------------------------------------------------------
// summarizeSaml
// ---------------------------------------------------------------------------

describe('summarizeSaml', () => {

  describe('SAMLResponse', () => {
    let summary;
    before(() => {
      summary = summarizeSaml(SAML_RESPONSE_XML);
    });

    test('extracts kind', () => {
      assert.equal(summary.kind, 'Response');
    });

    test('extracts issuer', () => {
      assert.equal(summary.issuer, 'https://idp.example.com');
    });

    test('extracts destination', () => {
      assert.equal(summary.destination, 'https://sp.example.com/acs');
    });

    test('extracts subject', () => {
      assert.equal(summary.subject, 'user@example.com');
    });

    test('extracts status', () => {
      assert.match(summary.status, /Success/);
    });

    test('extracts issueInstant', () => {
      assert.equal(summary.issueInstant, '2024-01-01T00:00:00Z');
    });

    test('extracts conditions notBefore', () => {
      assert.equal(summary.conditions.notBefore, '2024-01-01T00:00:00Z');
    });

    test('extracts conditions notOnOrAfter', () => {
      assert.equal(summary.conditions.notOnOrAfter, '2024-01-01T01:00:00Z');
    });

    test('extracts audience from conditions', () => {
      assert.equal(summary.conditions.audience, 'https://sp.example.com');
    });

    test('extracts attributes array', () => {
      assert.equal(summary.attributes.length, 2);
    });

    test('extracts attribute name', () => {
      const attr = summary.attributes.find(a => a.friendlyName === 'eduPersonEntitlement');
      assert.ok(attr);
      assert.equal(attr.name, 'urn:oid:1.3.6.1.4.1.5923.1.1.1.7');
    });

    test('extracts multiple attribute values', () => {
      const attr = summary.attributes.find(a => a.friendlyName === 'eduPersonEntitlement');
      assert.deepEqual(attr.values, ['member', 'admin']);
    });

    test('extracts single attribute value', () => {
      const attr = summary.attributes.find(a => a.friendlyName === 'email');
      assert.deepEqual(attr.values, ['user@example.com']);
    });
  });

  describe('AuthnRequest', () => {
    let summary;
    before(() => {
      summary = summarizeSaml(AUTHN_REQUEST_XML);
    });

    test('extracts kind', () => {
      assert.equal(summary.kind, 'AuthnRequest');
    });

    test('extracts issuer', () => {
      assert.equal(summary.issuer, 'https://sp.example.com');
    });

    test('extracts destination', () => {
      assert.equal(summary.destination, 'https://idp.example.com/sso');
    });

    test('has no conditions', () => {
      assert.equal(summary.conditions, null);
    });

    test('has no attributes', () => {
      assert.equal(summary.attributes.length, 0);
    });

    test('has no subject', () => {
      assert.equal(summary.subject, null);
    });
  });

  describe('error handling', () => {
    test('returns error kind on invalid XML', () => {
      const result = summarizeSaml('this is not xml at all');
      assert.equal(result.kind, 'unknown');
      assert.ok(result.error);
    });

    test('returns error kind on empty string', () => {
      const result = summarizeSaml('');
      assert.equal(result.kind, 'unknown');
    });
  });

});

// ---------------------------------------------------------------------------
// prettyPrintXml
// ---------------------------------------------------------------------------

describe('prettyPrintXml', () => {

  test('indents child elements', () => {
    const xml = '<root><child>text</child></root>';
    const out = prettyPrintXml(xml);
    assert.ok(out.includes('\n  <child>'));
  });

  test('closing tag dedents', () => {
    const xml = '<root><child>text</child></root>';
    const out = prettyPrintXml(xml);
    const lines = out.split('\n');
    const closingRoot = lines.find(l => l.includes('</root>'));
    assert.ok(closingRoot.startsWith('<'));
    assert.ok(!closingRoot.startsWith(' '));
  });

  test('does not add trailing newline', () => {
    const out = prettyPrintXml('<root><child/></root>');
    assert.ok(!out.endsWith('\n'));
  });

  test('handles self-closing tags without extra indent', () => {
    const xml = '<root><child/><sibling/></root>';
    const out = prettyPrintXml(xml);
    const lines = out.split('\n');
    const childLine  = lines.findIndex(l => l.includes('<child'));
    const siblingLine = lines.findIndex(l => l.includes('<sibling'));
    // Both should be at the same indentation level
    assert.equal(
      lines[childLine].match(/^ */)[0].length,
      lines[siblingLine].match(/^ */)[0].length
    );
  });

  test('handles xml declaration', () => {
    const xml = '<?xml version="1.0"?><root><child/></root>';
    const out = prettyPrintXml(xml);
    assert.ok(out.startsWith('<?xml'));
  });

  test('handles deeply nested elements', () => {
    const xml = '<root><level1><level2><deep>val</deep></level2></level1></root>';
    const out = prettyPrintXml(xml);
    assert.ok(out.includes('      <deep>'));
  });

  test('collapses existing whitespace between tags', () => {
    const messy = '<root>   \n   <child>   \n   text   \n   </child>   \n   </root>';
    const out = prettyPrintXml(messy);
    // Should not have multiple blank lines
    assert.ok(!out.includes('\n\n'));
  });

  test('returns non-empty string for real SAMLResponse', () => {
    const out = prettyPrintXml(SAML_RESPONSE_XML);
    assert.ok(out.length > 0);
    assert.ok(out.includes('<samlp:Response'));
  });

});
