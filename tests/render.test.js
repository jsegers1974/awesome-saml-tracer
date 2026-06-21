import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  escape, row, shortName, truncate,
  renderAttributes, renderConditions, renderSamlParams, renderHeaderTable,
  renderSamlDetail, renderSettingHelp, renderMetaCompare,
} from '../shared/render.js';

describe('escape', () => {
  test('escapes the five HTML-significant characters', () => {
    assert.equal(escape(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;');
  });
  test('leaves plain text untouched', () => {
    assert.equal(escape('hello world'), 'hello world');
  });
  test('coerces null and undefined to empty string', () => {
    assert.equal(escape(null), '');
    assert.equal(escape(undefined), '');
  });
  test('coerces non-strings', () => {
    assert.equal(escape(42), '42');
  });
});

describe('row', () => {
  test('returns empty string for null or empty value', () => {
    assert.equal(row('Issuer', null), '');
    assert.equal(row('Issuer', ''), '');
    assert.equal(row('Issuer', undefined), '');
  });
  test('emits a dt/dd pair for a present value', () => {
    assert.equal(row('Issuer', 'idp.example.com'), '<dt>Issuer</dt><dd>idp.example.com</dd>');
  });
  test('escapes both label and value', () => {
    assert.equal(row('a&b', '<x>'), '<dt>a&amp;b</dt><dd>&lt;x&gt;</dd>');
  });
});

describe('shortName', () => {
  test('returns the segment after the final slash', () => {
    assert.equal(shortName('http://schemas.example.com/identity/claims/emailaddress'), 'emailaddress');
  });
  test('returns everything after the final colon (dots are not delimiters)', () => {
    assert.equal(shortName('urn:oid:0.9.2342.19200300.100.1.3'), '0.9.2342.19200300.100.1.3');
  });
  test('returns the segment after the final hash', () => {
    assert.equal(shortName('http://example.com/schema#givenName'), 'givenName');
  });
  test('passes through a plain name with no delimiter', () => {
    assert.equal(shortName('email'), 'email');
  });
  test('returns empty string for falsy input', () => {
    assert.equal(shortName(''), '');
    assert.equal(shortName(null), '');
  });
});

describe('truncate', () => {
  test('leaves a short string unchanged', () => {
    assert.equal(truncate('hello', 10), 'hello');
  });
  test('leaves a string at exactly the limit unchanged', () => {
    assert.equal(truncate('hello', 5), 'hello');
  });
  test('truncates an over-length string with an ellipsis', () => {
    assert.equal(truncate('hello world', 5), 'hell…');
  });
});

describe('renderAttributes', () => {
  test('shows the encrypted-assertion notice when assertionEncrypted', () => {
    const out = renderAttributes({ assertionEncrypted: true, attributes: [] });
    assert.match(out, /Assertion is encrypted/);
    assert.doesNotMatch(out, /<table/);
  });

  test('encrypted assertion takes precedence over present attributes', () => {
    const out = renderAttributes({
      assertionEncrypted: true,
      attributes: [{ name: 'x', friendlyName: 'X', values: ['v'] }],
    });
    assert.match(out, /Assertion is encrypted/);
    assert.doesNotMatch(out, /<table/);
  });

  test('shows the encrypted-attribute notice when only encrypted attrs and none decoded', () => {
    const out = renderAttributes({ encryptedAttributeCount: 2, attributes: [] });
    assert.match(out, /2 attributes are individually encrypted/);
  });

  test('uses the singular noun for an encrypted-attribute count of one', () => {
    // Note: current behavior toggles only the noun's plural -s, not the verb,
    // so this reads "1 attribute are ...". Pinned as-is; grammar fix is a
    // separate follow-up outside this refactor.
    const out = renderAttributes({ encryptedAttributeCount: 1, attributes: [] });
    assert.match(out, /1 attribute are individually encrypted/);
  });

  test('shows the empty message when there are no attributes', () => {
    const out = renderAttributes({ attributes: [] });
    assert.match(out, /No SAML attributes in this message/);
  });

  test('treats a missing attributes array as empty', () => {
    const out = renderAttributes({});
    assert.match(out, /No SAML attributes in this message/);
  });

  test('renders a table with a row per attribute', () => {
    const out = renderAttributes({
      attributes: [
        { name: 'http://x/emailaddress', friendlyName: 'Email', values: ['a@b.com'] },
        { name: 'http://x/role', friendlyName: null, values: ['admin', 'user'] },
      ],
    });
    assert.match(out, /Attributes \(2\)/);
    assert.match(out, /margin-top:16px/);
    assert.match(out, /Email/);
    assert.match(out, /a@b\.com/);
    // friendlyName fallback to shortName when absent
    assert.match(out, /role/);
    // both values of the multi-valued attribute appear
    assert.match(out, /admin/);
    assert.match(out, /user/);
  });

  test('shows (no values) for an attribute with an empty values array', () => {
    const out = renderAttributes({
      attributes: [{ name: 'x', friendlyName: 'X', values: [] }],
    });
    assert.match(out, /\(no values\)/);
  });

  test('appends the additional-encrypted note when both plain and encrypted attrs exist', () => {
    const out = renderAttributes({
      encryptedAttributeCount: 3,
      attributes: [{ name: 'x', friendlyName: 'X', values: ['v'] }],
    });
    assert.match(out, /<table/);
    assert.match(out, /3 additional attributes are encrypted and not shown/);
  });

  test('escapes attribute values', () => {
    const out = renderAttributes({
      attributes: [{ name: 'x', friendlyName: 'X', values: ['<script>'] }],
    });
    assert.match(out, /&lt;script&gt;/);
    assert.doesNotMatch(out, /<script>/);
  });
});

describe('renderConditions', () => {
  test('returns empty string when there are no conditions', () => {
    assert.equal(renderConditions({}), '');
    assert.equal(renderConditions({ conditions: null }), '');
  });

  test('renders the present condition fields', () => {
    const out = renderConditions({
      conditions: {
        notBefore: '2026-06-04T00:00:00Z',
        notOnOrAfter: '2026-06-04T01:00:00Z',
        audience: 'https://sp.example.com',
      },
    });
    assert.match(out, /<h3>Conditions<\/h3>/);
    assert.match(out, /NotBefore/);
    assert.match(out, /2026-06-04T00:00:00Z/);
    assert.match(out, /NotOnOrAfter/);
    assert.match(out, /Audience/);
    assert.match(out, /https:\/\/sp\.example\.com/);
    assert.match(out, /margin-bottom:16px/);
  });

  test('omits rows for absent condition fields', () => {
    const out = renderConditions({ conditions: { notBefore: '2026-06-04T00:00:00Z' } });
    assert.match(out, /NotBefore/);
    assert.doesNotMatch(out, /NotOnOrAfter/);
    assert.doesNotMatch(out, /Audience/);
  });
});

describe('renderSamlParams', () => {
  test('returns empty string when there are no params', () => {
    assert.equal(renderSamlParams({}), '');
  });

  test('renders RelayState and a truncated SAMLResponse blob', () => {
    const blob = 'A'.repeat(200);
    const out = renderSamlParams({ relayState: 'state123', samlResponse: blob, source: 'form' });
    assert.match(out, /RelayState/);
    assert.match(out, /state123/);
    assert.match(out, /SAMLResponse/);
    // blob is previewed (first 64 chars), not shown in full
    assert.match(out, /A{64}…/);
    assert.doesNotMatch(out, new RegExp('A{100}'));
  });

  test('labels POST binding when source is not url', () => {
    const out = renderSamlParams({ samlResponse: 'x', source: 'form' });
    assert.match(out, /POST binding/);
  });

  test('labels Redirect binding when source is url', () => {
    const out = renderSamlParams({ samlRequest: 'x', source: 'url' });
    assert.match(out, /Redirect binding/);
    assert.match(out, /SAMLRequest/);
  });

  test('omits RelayState row when absent', () => {
    const out = renderSamlParams({ samlResponse: 'x', source: 'form' });
    assert.doesNotMatch(out, /RelayState/);
  });
});

describe('renderHeaderTable', () => {
  test('returns empty string for missing or empty headers', () => {
    assert.equal(renderHeaderTable('Request Headers', null), '');
    assert.equal(renderHeaderTable('Request Headers', []), '');
  });

  test('renders the label and a row per header', () => {
    const out = renderHeaderTable('Request Headers', [
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
      { name: 'Host', value: 'idp.example.com' },
    ]);
    assert.match(out, /Request Headers/);
    assert.match(out, /Content-Type/);
    assert.match(out, /application\/x-www-form-urlencoded/);
    assert.match(out, /Host/);
    assert.match(out, /idp\.example\.com/);
  });

  test('escapes header names and values', () => {
    const out = renderHeaderTable('H', [{ name: '<n>', value: '<v>' }]);
    assert.match(out, /&lt;n&gt;/);
    assert.match(out, /&lt;v&gt;/);
  });
});

describe('renderSamlDetail', () => {
  const summary = {
    kind: 'Response',
    issuer: 'idp.example.com',
    destination: 'https://sp.example.com/acs',
    subject: 'user@example.com',
    status: 'urn:...:Success',
    issueInstant: '2026-06-04T00:53:14Z',
    attributes: [{ name: 'http://x/email', friendlyName: 'Email', values: ['user@example.com'] }],
  };
  const XML = '<Response><Issuer>idp.example.com</Issuer></Response>';

  test('panel-style: heading, core rows, attributes, and raw XML', () => {
    const out = renderSamlDetail(summary, XML, 'base64', { url: 'https://sp.example.com/acs' });
    assert.match(out, /<h2>Response<\/h2>/);
    assert.match(out, /<dt>URL<\/dt>/);
    assert.match(out, /<dt>Issuer<\/dt><dd>idp\.example\.com<\/dd>/);
    assert.match(out, /<dt>Encoding<\/dt><dd>base64<\/dd>/);
    assert.match(out, /Attributes \(1\)/);
    assert.match(out, /<summary>Raw XML<\/summary>/);
    // no Time row, no source span, no params, no headers
    assert.doesNotMatch(out, /<dt>Time<\/dt>/);
    assert.doesNotMatch(out, /Parameters/);
    assert.doesNotMatch(out, /Request Headers/);
  });

  test('falls back to Unknown when kind and kindFallback are absent', () => {
    const out = renderSamlDetail({ attributes: [] }, XML, 'base64', { url: 'x' });
    assert.match(out, /<h2>Unknown<\/h2>/);
  });

  test('shows the Assertion row only when the assertion is encrypted', () => {
    const enc = renderSamlDetail({ ...summary, assertionEncrypted: true }, XML, 'base64', { url: 'x' });
    assert.match(enc, /<dt>Assertion<\/dt><dd>Encrypted<\/dd>/);
    const plain = renderSamlDetail(summary, XML, 'base64', { url: 'x' });
    assert.doesNotMatch(plain, /<dt>Assertion<\/dt>/);
  });

  test('popup-style: includes params table and header tables', () => {
    const out = renderSamlDetail(summary, XML, 'base64', {
      url: 'https://sp.example.com/acs',
      params: { samlResponse: 'BLOB', relayState: 'state1', source: 'form' },
      networkEntry: {
        requestHeaders: [{ name: 'Host', value: 'sp.example.com' }],
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
      },
    });
    assert.match(out, /Parameters/);
    assert.match(out, /RelayState/);
    assert.match(out, /Request Headers/);
    assert.match(out, /Response Headers/);
    assert.match(out, /Content-Type/);
  });

  test('viewer-style: leading Time row and source label in heading', () => {
    const out = renderSamlDetail(summary, XML, 'pre-decoded', {
      url: 'https://sp.example.com/acs',
      time: '6/4/2026, 12:53:14 AM',
      sourceLabel: 'saml-tracer',
      kindFallback: 'SAMLResponse',
    });
    assert.match(out, /<dt>Time<\/dt><dd>6\/4\/2026, 12:53:14 AM<\/dd>/);
    assert.match(out, /<span class="muted"[^>]*>saml-tracer<\/span>/);
    // Time row precedes the URL row
    assert.ok(out.indexOf('<dt>Time</dt>') < out.indexOf('<dt>URL</dt>'));
  });
});

describe('renderSettingHelp', () => {
  const content = {
    title: 'Highlight domains',
    examples: ['*mycompany.com', '*okta.com'],
    note: 'Marks matching captures with a star.',
  };
  const DOCS = 'https://ast-web.pages.dev/how-to#settings';

  test('renders the title, examples, and note', () => {
    const out = renderSettingHelp(content, DOCS);
    assert.match(out, /Highlight domains/);
    assert.match(out, /\*mycompany\.com/);
    assert.match(out, /\*okta\.com/);
    assert.match(out, /Marks matching captures with a star/);
  });

  test('includes a docs link to the settings anchor when a url is given', () => {
    const out = renderSettingHelp(content, DOCS);
    assert.match(out, /href="https:\/\/ast-web\.pages\.dev\/how-to#settings"/);
    assert.match(out, /target="_blank"/);
    assert.match(out, /rel="noopener"/);
    assert.match(out, /Full docs/);
  });

  test('omits the docs link when no url is given', () => {
    const out = renderSettingHelp(content);
    assert.doesNotMatch(out, /help-docs-link/);
  });

  test('handles a setting with no examples', () => {
    const out = renderSettingHelp({ title: 'X', note: 'just a note' }, DOCS);
    assert.doesNotMatch(out, /help-examples/);
    assert.match(out, /just a note/);
  });

  test('escapes example and title content', () => {
    const out = renderSettingHelp({ title: '<t>', examples: ['<e>'], note: '<n>' }, DOCS);
    assert.match(out, /&lt;t&gt;/);
    assert.match(out, /&lt;e&gt;/);
    assert.match(out, /&lt;n&gt;/);
    assert.doesNotMatch(out, /<t>/);
  });
});

describe('renderMetaCompare', () => {
  const result = {
    summary: { matches: 1, mismatches: 1, missing: 0, unknown: 1 },
    checks: [
      { id: 'issuer', label: 'Issuer', status: 'match', expected: 'idp', actual: 'idp', hint: null },
      { id: 'signing-cert', label: 'Signing certificate', status: 'mismatch', expected: '1 cert(s)', actual: 'abc…', hint: 'Likely a certificate rotation.' },
      { id: 'audience', label: 'Audience', status: 'unknown', expected: null, actual: null, hint: 'No SP metadata provided.' },
    ],
  };

  test('renders the summary counts', () => {
    const out = renderMetaCompare(result);
    assert.match(out, /1 matched/);
    assert.match(out, /1 mismatched/);
    assert.match(out, /1 not checked/);
  });

  test('renders a row per check with status class', () => {
    const out = renderMetaCompare(result);
    assert.match(out, /mc-match/);
    assert.match(out, /mc-mismatch/);
    assert.match(out, /mc-unknown/);
    assert.match(out, /Signing certificate/);
  });

  test('shows the hint for a mismatch but not for a match', () => {
    const out = renderMetaCompare(result);
    assert.match(out, /Likely a certificate rotation/);
    // a matching row carries no hint block
    assert.doesNotMatch(out, /mc-hint">[^<]*idp/);
  });

  test('empty result shows an add-metadata prompt', () => {
    assert.match(renderMetaCompare({ checks: [] }), /add metadata/i);
    assert.match(renderMetaCompare(null), /add metadata/i);
  });

  test('escapes check content', () => {
    const out = renderMetaCompare({ summary: {}, checks: [
      { id: 'x', label: '<lbl>', status: 'mismatch', expected: '<e>', actual: '<a>', hint: '<h>' },
    ] });
    assert.match(out, /&lt;lbl&gt;/);
    assert.match(out, /&lt;a&gt;/);
    assert.doesNotMatch(out, /<lbl>/);
  });
});
