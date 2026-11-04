/**
 * @license
 * Eras-Birhan Pharmaceuticals Stock Management System (EBP-SMS)
 * Native Offline IndexedDB Storage Engine
 * Copyright (c) 2026 IDG, ETHIOPIA. Developer: Assefa Gashaye (+251918203416)
 */

const DB_NAME = 'EBPSMS_SecureDB';
const DB_VERSION = 1;

export interface DBStores {
  stock: string;
  sales: string;
  audit: string;
  transactions: string;
  devices: string;
  settings: string;
  snapshots: string;
}

export class SecureIndexedDBManager {
  private db: IDBDatabase | null = null;
  private isAvailable = false;

  constructor() {
    this.isAvailable = typeof indexedDB !== 'undefined';
  }

  async init(): Promise<boolean> {
    if (!this.isAvailable) return false;

    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
          const db = (e.target as IDBOpenDBRequest).result;
          const stores = ['stock', 'sales', 'audit', 'transactions', 'devices', 'settings', 'snapshots'];
          stores.forEach((store) => {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
            }
          });
        };

        req.onsuccess = (e: Event) => {
          this.db = (e.target as IDBOpenDBRequest).result;
          resolve(true);
        };

        req.onerror = () => {
          console.warn('[IndexedDB] Failed to open database, falling back to LocalStorage');
          resolve(false);
        };
      } catch (err) {
        console.warn('[IndexedDB] Initialization exception:', err);
        resolve(false);
      }
    });
  }

  async saveAll(storeName: string, items: any[]): Promise<boolean> {
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();

        items.forEach((item, index) => {
          // Ensure every record has an id
          const record = typeof item === 'object' && item !== null
            ? { ...item, id: item.id !== undefined ? item.id : index + 1 }
            : { value: item, id: index + 1 };
          store.put(record);
        });

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async getAll(storeName: string): Promise<any[]> {
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async setKey(storeName: string, key: string, value: any): Promise<boolean> {
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put({ id: key, data: value, updatedAt: new Date().toISOString() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async getKey(storeName: string, key: string): Promise<any> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async clearStore(storeName: string): Promise<boolean> {
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}
