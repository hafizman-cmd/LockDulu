const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

test("development replaces a cached Prisma client when the generated client reloads", () => {
  const code = ts.transpileModule(readFileSync("lib/db.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scope = { process: { env: { NODE_ENV: "development" } } };
  const dependencies = {
    "@prisma/adapter-libsql": { PrismaLibSql: class {} },
    "./database-config.ts": { databaseConfig: () => ({}) },
    "node:timers/promises": { setTimeout },
  };
  const load = PrismaClient => {
    scope.exports = {};
    scope.require = name => name === "../generated/prisma/client.ts" ? { PrismaClient } : dependencies[name];
    vm.runInNewContext(`(() => { ${code} })()`, scope);
    return scope.exports.db;
  };

  class OriginalClient {}
  class RegeneratedClient {}
  const original = load(OriginalClient)();
  assert.equal(load(OriginalClient)(), original);
  const regenerated = load(RegeneratedClient);
  const updated = regenerated();
  assert.ok(updated instanceof RegeneratedClient);
  assert.equal(regenerated(), updated);
});
