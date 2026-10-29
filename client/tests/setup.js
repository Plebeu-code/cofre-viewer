// Ambiente dos testes: IndexedDB (idb-keyval) e localStorage em memoria.
import { vi, beforeEach } from 'vitest'

const db = new Map()
vi.mock('idb-keyval', () => ({
  get: async (k) => structuredClone(db.get(k)),
  set: async (k, v) => { db.set(k, structuredClone(v)) },
  del: async (k) => { db.delete(k) },
}))

const ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
  clear: () => ls.clear(),
}

beforeEach(() => { db.clear(); ls.clear() })
