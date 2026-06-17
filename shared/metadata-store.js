// Persistence for MetaCompare metadata. Bridges the pure parser (metadata.js)
// and the IndexedDB layer (db.js). Stores one record per entity (keyed by
// entityID) so an IdP file and an SP file uploaded separately both accumulate,
// and a capture can be compared against everything on hand.

import { parseMetadata } from './metadata.js';
import { put, getAll, del, clear } from './db.js';

const STORE = 'metadata';

/**
 * Parse and persist uploaded metadata XML (one record per entity).
 * @returns the parse result (so callers can surface parse errors).
 */
export async function saveMetadata(rawXml) {
  const parsed = parseMetadata(rawXml);
  if (parsed.error || !parsed.entities.length) return parsed;
  for (const entity of parsed.entities) {
    if (!entity.entityID) continue;
    const role = entity.idp && entity.sp ? 'both' : entity.idp ? 'idp' : 'sp';
    await put(STORE, { entityID: entity.entityID, role, rawXml, entity, savedAt: Date.now() });
  }
  return parsed;
}

/** All stored metadata records. */
export const listMetadata = () => getAll(STORE);

/** Forget one entity's metadata. */
export const deleteMetadata = (entityID) => del(STORE, entityID);

/** Forget all stored metadata. */
export const clearMetadata = () => clear(STORE);

/**
 * Build the {entities} structure metaCompare() expects from everything stored.
 * metaCompare picks the relevant IdP (by issuer) and SP (by audience) itself.
 */
export async function loadMetadataForCompare() {
  const records = await listMetadata();
  return { entities: records.map(r => r.entity) };
}
