import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from '../shared/jwt.js';

// Build a JWT from plain objects without a real signature
function makeJwt(header, payload, sig = 'fakesig') {
  const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc(header)}.${enc(payload)}.${sig}`;
}

const NOW = Math.floor(Date.now() / 1000);
const FUTURE_EXP = NOW + 3600;
const PAST_EXP   = NOW - 3600;

describe('decodeJwt', () => {

  describe('input validation', () => {
    test('throws on empty string', () => {
      assert.throws(() => decodeJwt(''), /empty/i);
    });

    test('throws on null', () => {
      assert.throws(() => decodeJwt(null), /empty/i);
    });

    test('throws on single segment', () => {
      assert.throws(() => decodeJwt('onlyone'), /segments/i);
    });

    test('throws on four segments', () => {
      assert.throws(() => decodeJwt('a.b.c.d'), /segments/i);
    });

    test('throws on invalid base64 in header', () => {
      assert.throws(() => decodeJwt('!!!.eyJzdWIiOiJ4In0.sig'), /base64/i);
    });

    test('throws on invalid JSON in payload', () => {
      const badPayload = Buffer.from('not-json').toString('base64url');
      const header = Buffer.from('{"alg":"HS256"}').toString('base64url');
      assert.throws(() => decodeJwt(`${header}.${badPayload}.sig`), /JSON/i);
    });
  });

  describe('decoding structure', () => {
    test('returns header, payload, signature, claims', () => {
      const jwt = makeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'u1' });
      const result = decodeJwt(jwt);
      assert.ok('header' in result);
      assert.ok('payload' in result);
      assert.ok('signature' in result);
      assert.ok('claims' in result);
    });

    test('decodes header fields', () => {
      const jwt = makeJwt({ alg: 'RS256', typ: 'JWT', kid: 'key1' }, { sub: 'u1' });
      const { header } = decodeJwt(jwt);
      assert.equal(header.alg, 'RS256');
      assert.equal(header.typ, 'JWT');
      assert.equal(header.kid, 'key1');
    });

    test('decodes payload fields', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { sub: 'user@example.com', custom: 42 });
      const { payload } = decodeJwt(jwt);
      assert.equal(payload.sub, 'user@example.com');
      assert.equal(payload.custom, 42);
    });

    test('preserves signature string', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { sub: 'u1' }, 'mysignature');
      const { signature } = decodeJwt(jwt);
      assert.equal(signature, 'mysignature');
    });

    test('accepts two-part token (no signature)', () => {
      const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
      const jwt = `${enc({ alg: 'none' })}.${enc({ sub: 'u1' })}`;
      const { signature } = decodeJwt(jwt);
      assert.equal(signature, '');
    });

    test('handles base64url characters (- and _)', () => {
      // Payload with characters that differ between base64 and base64url
      const payload = { sub: 'user+with/special=chars' };
      const jwt = makeJwt({ alg: 'HS256' }, payload);
      const { payload: decoded } = decodeJwt(jwt);
      assert.equal(decoded.sub, payload.sub);
    });
  });

  describe('claims extraction', () => {
    test('extracts issuer', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { iss: 'https://idp.example.com' });
      assert.equal(decodeJwt(jwt).claims.issuer, 'https://idp.example.com');
    });

    test('extracts subject', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { sub: 'user@example.com' });
      assert.equal(decodeJwt(jwt).claims.subject, 'user@example.com');
    });

    test('extracts string audience', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { aud: 'https://sp.example.com' });
      assert.equal(decodeJwt(jwt).claims.audience, 'https://sp.example.com');
    });

    test('joins array audience', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { aud: ['https://sp1.example.com', 'https://sp2.example.com'] });
      assert.equal(decodeJwt(jwt).claims.audience, 'https://sp1.example.com, https://sp2.example.com');
    });

    test('converts iat to ISO string', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { iat: 1700000000 });
      assert.equal(decodeJwt(jwt).claims.issuedAt, new Date(1700000000 * 1000).toISOString());
    });

    test('converts exp to ISO string', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: FUTURE_EXP });
      assert.ok(decodeJwt(jwt).claims.expiresAt);
    });

    test('converts nbf to ISO string', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { nbf: 1700000000 });
      assert.equal(decodeJwt(jwt).claims.notBefore, new Date(1700000000 * 1000).toISOString());
    });

    test('extracts jti', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { jti: 'unique-id-123' });
      assert.equal(decodeJwt(jwt).claims.jwtId, 'unique-id-123');
    });

    test('marks valid token as not expired', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: FUTURE_EXP });
      assert.equal(decodeJwt(jwt).claims.expired, false);
    });

    test('marks expired token as expired', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: PAST_EXP });
      assert.equal(decodeJwt(jwt).claims.expired, true);
    });

    test('includes expiresIn for future token', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: FUTURE_EXP });
      const { expiresIn } = decodeJwt(jwt).claims;
      assert.ok(expiresIn);
      assert.match(expiresIn, /from now/);
    });

    test('includes expiresIn for past token', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: PAST_EXP });
      const { expiresIn } = decodeJwt(jwt).claims;
      assert.ok(expiresIn);
      assert.match(expiresIn, /ago/);
    });

    test('omits missing claims', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { sub: 'u1' });
      const { claims } = decodeJwt(jwt);
      assert.equal(claims.issuer, undefined);
      assert.equal(claims.expiresAt, undefined);
      assert.equal(claims.expired, undefined);
    });

    test('returns empty claims for non-object payload', () => {
      const enc = s => Buffer.from(s).toString('base64url');
      const header = enc('{"alg":"none"}');
      const payload = enc('"just a string"');
      const { claims } = decodeJwt(`${header}.${payload}.`);
      assert.deepEqual(claims, {});
    });
  });

  describe('human duration formatting', () => {
    test('expiry in days', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: NOW + 86400 * 2 });
      assert.match(decodeJwt(jwt).claims.expiresIn, /day/);
    });

    test('expiry in hours', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: NOW + 3600 * 3 });
      assert.match(decodeJwt(jwt).claims.expiresIn, /hour/);
    });

    test('expiry in minutes', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: NOW + 60 * 5 });
      assert.match(decodeJwt(jwt).claims.expiresIn, /minute/);
    });

    test('expiry in seconds', () => {
      const jwt = makeJwt({ alg: 'HS256' }, { exp: NOW + 45 });
      assert.match(decodeJwt(jwt).claims.expiresIn, /second/);
    });
  });

});
