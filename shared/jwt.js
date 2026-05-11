// JWT decoding helpers. Pure ES module.

export function decodeJwt(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new Error('Empty token');
  const parts = trimmed.split('.');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Expected 2 or 3 dot-separated segments, got ${parts.length}.`);
  }
  const [headerPart, payloadPart, signaturePart = ''] = parts;
  const header = parseJsonSegment(headerPart, 'header');
  const payload = parseJsonSegment(payloadPart, 'payload');
  return {
    header,
    payload,
    signature: signaturePart,
    claims: extractClaims(payload)
  };
}

function parseJsonSegment(segment, label) {
  let text;
  try {
    text = base64UrlDecode(segment);
  } catch (e) {
    throw new Error(`Invalid base64url in ${label}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${label}: ${e.message}`);
  }
}

function base64UrlDecode(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  const bin = atob(norm + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function extractClaims(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const epoch = (n) => (typeof n === 'number' ? new Date(n * 1000).toISOString() : null);
  const out = {};
  if ('iss' in payload) out.issuer = payload.iss;
  if ('sub' in payload) out.subject = payload.sub;
  if ('aud' in payload) out.audience = Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud;
  if ('iat' in payload) out.issuedAt = epoch(payload.iat);
  if ('nbf' in payload) out.notBefore = epoch(payload.nbf);
  if ('exp' in payload) {
    out.expiresAt = epoch(payload.exp);
    if (typeof payload.exp === 'number') {
      const diffSec = payload.exp - Math.floor(Date.now() / 1000);
      out.expiresIn = humanDuration(diffSec);
      out.expired = diffSec <= 0;
    }
  }
  if ('jti' in payload) out.jwtId = payload.jti;
  return out;
}

function humanDuration(sec) {
  const abs = Math.abs(sec);
  const sign = sec < 0 ? 'ago' : 'from now';
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ];
  for (const [label, span] of units) {
    if (abs >= span) {
      const n = Math.round(abs / span);
      return `${n} ${label}${n === 1 ? '' : 's'} ${sign}`;
    }
  }
  return `${sec} seconds ${sign}`;
}
