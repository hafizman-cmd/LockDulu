const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync("components/client.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function checkoutStorage(localStorage) {
  const exports = {};
  vm.runInNewContext(source, {
    exports, require: () => ({}), Event, window: { localStorage, dispatchEvent() {} },
  });
  return exports;
}

const lock = { itemId: "item", token: "token", storeSlug: "shop" };

test("saving checkout confirms persistent access to the reserved order", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const { saveLock } = checkoutStorage(storage);
  assert.equal(saveLock(lock), true);
  assert.equal(saveLock({ ...lock, orderId: "order" }), true);

  const { savedLocks } = checkoutStorage(storage);
  assert.deepEqual(Array.from(savedLocks(), entry => entry.orderId), ["order"]);
});

test("an in-memory lock is recoverable in the current page but does not count as persistent access", () => {
  function blocked() { throw new Error("Browser storage is blocked"); }
  const { saveLock, savedLocks } = checkoutStorage({ getItem: blocked, setItem: blocked });
  assert.equal(saveLock({ ...lock, orderId: "order" }), false);
  assert.equal(savedLocks()[0].orderId, "order");
});

test("a stored token without its order ID does not pass when the reservation update cannot be saved", () => {
  const { saveLock } = checkoutStorage({ getItem: () => JSON.stringify([lock]), setItem() {} });
  assert.equal(saveLock({ ...lock, orderId: "order" }), false);
});
