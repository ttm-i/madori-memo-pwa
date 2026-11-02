import test from "node:test";
import assert from "node:assert/strict";
import { saveActivePlan } from "../dist/db.js";

test("IndexedDB saves resolve only after the transaction commits", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  let transaction;
  let closed = false;
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      transaction = {
        objectStore: () => ({
          put: () => {
            const request = {};
            queueMicrotask(() => {
              request.result = "active-plan";
              request.onsuccess?.();
            });
            return request;
          },
        }),
      };
      return transaction;
    },
    close() { closed = true; },
  };
  globalThis.indexedDB = {
    open: () => {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };

  try {
    let resolved = false;
    const saving = saveActivePlan({ meta: { title: "test" } }).then(() => { resolved = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);
    assert.equal(closed, false);

    transaction.oncomplete();
    await saving;
    assert.equal(resolved, true);
    assert.equal(closed, true);
  } finally {
    if (originalIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDb;
  }
});
