// IndexedDB wrapper for resumable uploads.
//
// Database: narraterx-uploads  (version 1)
// Object store: uploads
//   keyPath: 'id'
//   indexes: createdAt (for hydration ordering)
//
// Record shape (see src/lib/resumableUpload.js for full semantics):
//   {
//     id: string,                  // UUID, also React row id
//     status: 'pending',           // only 'pending' rows hydrate as 'paused'
//     pathname: string,            // chosen at /create time
//     contentType: string,
//     uploadId: string,            // from Vercel createMultipartUpload
//     key: string,
//     clientToken: string,         // long-lived (24h) part-upload token
//     tokenExpiresAt: number,      // ms epoch
//     filename: string,
//     fileSize: number,
//     fileType: string,
//     fileLastModified: number,    // staleness detection on resume
//     fileBlob: File,              // structured-clonable
//     partSize: number,
//     completedParts: Array<{ partNumber: number, etag: string }>,
//     tokenPayloadServer: string,  // opaque server-issued JSON, echoed to /complete
//     meta: object,                // for display on tray retry
//     workspaceHost: string,       // host at create time; cross-host resume is blocked
//     createdAt: number,
//     updatedAt: number,
//   }
//
// The store is per-origin, so different workspaces on different subdomains
// each see their own pending uploads — exactly what we want for tenant
// isolation.

const DB_NAME = 'narraterx-uploads'
const STORE   = 'uploads'
const VERSION = 1

let _dbPromise = null

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  return _dbPromise
}

function run(mode, fn) {
  return openDb().then(
    (db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      let result
      tx.oncomplete = () => resolve(result)
      tx.onerror    = () => reject(tx.error)
      tx.onabort    = () => reject(tx.error)
      Promise.resolve(fn(store)).then((r) => { result = r }, reject)
    }),
  )
}

export async function putUpload(record) {
  return run('readwrite', (store) => new Promise((resolve, reject) => {
    const req = store.put({ ...record, updatedAt: Date.now() })
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  }))
}

export async function getUpload(id) {
  return run('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror   = () => reject(req.error)
  }))
}

export async function listUploads() {
  return run('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror   = () => reject(req.error)
  }))
}

export async function deleteUpload(id) {
  return run('readwrite', (store) => new Promise((resolve, reject) => {
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  }))
}

// Patch a subset of fields on an existing record. Read-modify-write inside a
// single transaction so concurrent part completions don't clobber each other.
export async function patchUpload(id, patch) {
  return run('readwrite', (store) => new Promise((resolve, reject) => {
    const getReq = store.get(id)
    getReq.onerror = () => reject(getReq.error)
    getReq.onsuccess = () => {
      const existing = getReq.result
      if (!existing) {
        resolve(null)
        return
      }
      const next = { ...existing, ...patch, updatedAt: Date.now() }
      const putReq = store.put(next)
      putReq.onsuccess = () => resolve(next)
      putReq.onerror   = () => reject(putReq.error)
    }
  }))
}
