import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escape, row, shortName, truncate, renderAttributes } from '../shared/render.js';

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
