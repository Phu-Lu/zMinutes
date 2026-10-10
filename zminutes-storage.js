/* Small IndexedDB repository. The app stays useful if IndexedDB is unavailable. */
(() => {
  const DB_NAME = 'zminutes-local';
  const DB_VERSION = 1;
  let opening;

  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local database'));
      request.onblocked = () => reject(new Error('Close another zMinutes tab to finish the local data upgrade.'));
    });
    return opening;
  }

  async function get(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const request = tx.objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(key, value, silent = false) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').put(value, key);
      tx.oncomplete = () => {
        if (!silent) window.dispatchEvent(new CustomEvent('zminutes:datachange', { detail: { key } }));
        resolve(true);
      };
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save local data'));
    });
  }

  window.ZMinutesStore = { get, put, open };
})();
