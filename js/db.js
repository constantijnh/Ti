/* db.js — kleine IndexedDB-laag voor Thuisinventaris
 * Twee stores: "locaties" en "spullen". Geen backend nodig, alles blijft
 * lokaal in de browser van de gebruiker.
 */
const DB_NAME = 'thuisinventaris';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('locaties')) {
        db.createObjectStore('locaties', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('spullen')) {
        const store = db.createObjectStore('spullen', { keyPath: 'id' });
        store.createIndex('locatieId', 'locatieId', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

const DB = {
  _db: null,
  async init() {
    this._db = await openDB();
    return this._db;
  },
  _store(name, mode = 'readonly') {
    return this._db.transaction(name, mode).objectStore(name);
  },
  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._store(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async get(storeName, id) {
    return new Promise((resolve, reject) => {
      const req = this._store(storeName).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async put(storeName, obj) {
    return new Promise((resolve, reject) => {
      const req = this._store(storeName, 'readwrite').put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    });
  },
  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const req = this._store(storeName, 'readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._store(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
