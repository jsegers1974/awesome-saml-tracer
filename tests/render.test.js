import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escape, row, shortName, truncate } from '../shared/render.js';

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
