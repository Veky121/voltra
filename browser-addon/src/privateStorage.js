import {extension} from './platform.js';

// Firefox cannot restrict storage.local to extension pages. Keep all durable
// account/queue state in the extension origin's IndexedDB instead. Content
// scripts have the visited page's origin and cannot read this database.
export function indexedStorage(indexedDB, notify = () => {}) {
  let opening;
  const database = () => opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('voltra-companion-private', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('storage-unavailable'));
    request.onblocked = () => reject(new Error('storage-unavailable'));
  });
  const transact = async (mode, action) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error('storage-unavailable'));
      action(tx.objectStore('state'), value => { result = value; });
    });
  };
  return {
    get: key => transact('readonly', (store, done) => {
      if (key !== null) {
        const request = store.get(key);
        request.onsuccess = () => done({[key]:request.result});
      } else {
        const values = store.getAll(), keys = store.getAllKeys();
        keys.onsuccess = () => done(Object.fromEntries(keys.result.map((key, i) => [key, values.result[i]])));
      }
    }),
    set: async values => {
      await transact('readwrite', store => {
        for (const [key, value] of Object.entries(values)) store.put(value, key);
      });
      notify(Object.keys(values));
    },
    remove: async keys => {
      keys = Array.isArray(keys) ? keys : [keys];
      await transact('readwrite', store => { for (const key of keys) store.delete(key); });
      notify(keys);
    },
  };
}

const restrictedLocal = !!extension.storage.local.setAccessLevel;
export const local = restrictedLocal ? extension.storage.local : indexedStorage(globalThis.indexedDB, keys => {
  if (keys.some(key => key.startsWith('request:') || key === 'lastRequest')) {
    // Send no stored values, especially credentials, in change notifications.
    extension.runtime.sendMessage({type:'queue-changed'}).catch(() => {});
  }
});
export const storageReady = Promise.all([
  restrictedLocal && extension.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  extension.storage.session?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}),
]);
