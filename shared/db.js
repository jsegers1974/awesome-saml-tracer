// IndexedDB foundation for the Pro features. One database, three stores:
//
//   baselines — saved assertion baselines for diffing (assertion-diff).
//               Auto-keyed; indexed by entityId (many baselines per SSO).
//   metadata  — uploaded SAML metadata for MetaCompare, keyed by entityID.
//   keystore  — decryption private-key file handles, keyed by id.
//
// Promise-wrapped generic CRUD; feature modules build their own thin helpers on
// top (saveMetadata, listBaselines, …). chrome.storage.local is fine for small
// flat values, but these stores hold large/structured data and (for keystore)
// FileSystemFileHandle objects, which only IndexedDB can persist.

export const DB_NAME = 'ast-pro';
export const DB_VERSION = 1;

export const SCHEMA = {
  baselines: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'entityId', keyPath: 'entityId' }] },
  metadata:  { keyPath: 'entityID' },
  keystore:  { keyPath: 'id' },
};

let dbPromise = null;

/** Open (and cache) the database, creating stores on first run / upgrade. */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: def.keyPath,
          autoIncrement: !!def.autoIncrement,
        });
        for (const idx of def.indexes || []) {
          store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Resolve/reject a promise from a single IDBRequest.
function fromRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Insert or update a record; resolves to its key. */
export async function put(store, value) {
  const db = await openDb();
  return fromRequest(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

/** Get one record by key (undefined if absent). */
export async function get(store, key) {
  const db = await openDb();
  return fromRequest(db.transaction(store, 'readonly').objectStore(store).get(key));
}

/** All records in a store. */
export async function getAll(store) {
  const db = await openDb();
  return fromRequest(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/** All records whose index equals value (e.g. baselines for one entityId). */
export async function getAllByIndex(store, indexName, value) {
  const db = await openDb();
  const idx = db.transaction(store, 'readonly').objectStore(store).index(indexName);
  return fromRequest(idx.getAll(value));
}

/** Delete one record by key. */
export async function del(store, key) {
  const db = await openDb();
  return fromRequest(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/** Remove every record from a store. */
export async function clear(store) {
  const db = await openDb();
  return fromRequest(db.transaction(store, 'readwrite').objectStore(store).clear());
}

/** Test seam: drop the cached connection so a fresh openDb() runs. */
export function _resetForTests() {
  dbPromise = null;
}
