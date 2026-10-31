const DB_NAME = "floor-plan-private";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const ACTIVE_KEY = "active-plan";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export function loadActivePlan() {
  return transaction("readonly", (store) => store.get(ACTIVE_KEY));
}

export function saveActivePlan(plan) {
  return transaction("readwrite", (store) => store.put(plan, ACTIVE_KEY));
}

export function deleteActivePlan() {
  return transaction("readwrite", (store) => store.delete(ACTIVE_KEY));
}

