// vfs.js — IndexedDB-backed virtual filesystem.
// Folders are explicit entries (kind: "folder", content: null), not inferred
// from file paths. This is what lets an empty folder exist and keeps
// rename/delete cascades simple and correct.

const DB_NAME = "anvil-fs";
const STORE = "files";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class VFS {
  constructor(db) { this.db = db; }

  static async create() {
    const db = await openDB();
    return new VFS(db);
  }

  store(mode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  list() {
    return new Promise((resolve, reject) => {
      const req = this.store("readonly").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  exists(path) {
    return new Promise((resolve, reject) => {
      const req = this.store("readonly").get(path);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
  }

  put(entry) {
    return new Promise((resolve, reject) => {
      const req = this.store("readwrite").put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async writeFile(path, content) {
    await this.put({ path, kind: "file", content, updatedAt: Date.now() });
  }

  async createFolder(path) {
    await this.put({ path, kind: "folder", content: null, updatedAt: Date.now() });
  }

  delete(path) {
    return new Promise((resolve, reject) => {
      const req = this.store("readwrite").delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Deletes a file, or a folder and everything nested under it.
  async remove(path) {
    const all = await this.list();
    const toDelete = all.filter(f => f.path === path || f.path.startsWith(path + "/"));
    for (const f of toDelete) await this.delete(f.path);
  }

  // Renames a file, or a folder (cascading the prefix to every descendant).
  // Throws if the destination path is already taken.
  async rename(oldPath, newPath) {
    if (oldPath === newPath) return;
    const all = await this.list();
    const clash = all.some(f => f.path === newPath);
    if (clash) throw new Error(`"${newPath}" already exists`);

    const toMove = all.filter(f => f.path === oldPath || f.path.startsWith(oldPath + "/"));
    for (const f of toMove) {
      const nextPath = f.path === oldPath ? newPath : newPath + f.path.slice(oldPath.length);
      await this.delete(f.path);
      await this.put({ ...f, path: nextPath, updatedAt: Date.now() });
    }
  }
}
