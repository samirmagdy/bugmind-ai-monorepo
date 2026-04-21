import { BugReport } from '../types';

const DB_NAME = 'BugMindDB';
const STORE_NAME = 'tab_bugs';
const META_STORE = 'jira_metadata';
const DB_VERSION = 2;

export class BugMindDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const target = event.target as IDBOpenDBRequest;
        const db = target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE); // Key will be baseUrl + projectId + issueTypeId
        }
      };


      request.onsuccess = (event: Event) => {
        const target = event.target as IDBOpenDBRequest;
        this.db = target.result;
        resolve();
      };

      request.onerror = (event: Event) => {
        const target = event.target as IDBOpenDBRequest;
        reject('IndexedDB error: ' + target.error);
      };
    });
  }

  async saveBugs(tabId: number, bugs: BugReport[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(bugs, tabId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getBugs(tabId: number): Promise<BugReport[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(tabId);

      request.onsuccess = () => resolve((request.result as BugReport[]) || []);
      request.onerror = () => reject(request.error);
    });
  }

  async clearBugs(tabId: number): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(tabId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveMetadata<T>(key: string, data: T): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([META_STORE], 'readwrite');
      const store = transaction.objectStore(META_STORE);
      const request = store.put(data, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMetadata<T>(key: string): Promise<T | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([META_STORE], 'readonly');
      const store = transaction.objectStore(META_STORE);
      const request = store.get(key);

      request.onsuccess = () => resolve((request.result as T | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  }

  async clearMetadata(key: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([META_STORE], 'readwrite');
      const store = transaction.objectStore(META_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllMetadata(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('DB not initialized');
      const transaction = this.db.transaction([META_STORE], 'readwrite');
      const store = transaction.objectStore(META_STORE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}


export const dbService = new BugMindDB();
