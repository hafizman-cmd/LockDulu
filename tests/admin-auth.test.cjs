const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

function adminWith(variables) {
  const stored = new Map();
  const headers = { cookies: async () => ({
    get: name => stored.get(name),
    set: (name, value, options) => stored.set(name, { value, options }),
  }) };
  let now = Date.now();

  function load(file, dependencies = {}) {
    const exports = {};
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      exports, require: name => dependencies[name] ?? require(name), Buffer,
      Date: { now: () => now }, process: { env: variables },
    });
    return exports;
  }

  const security = load("lib/security.ts", { "next/headers.js": headers });
  const auth = load("lib/admin-auth.ts", { "./security": security, "next/headers": headers });
  const actions = load("app/admin/dashboard/actions.ts", {
    "@/lib/admin-auth": auth,
    "next/navigation": { redirect: path => { throw new Error(`Redirect to ${path}`); } },
  });
  return { ...auth, ...actions, security, stored, advance: milliseconds => { now += milliseconds; } };
}

const password = "unique example password é";
const secret = "an example key used in this test only";
const adminCookie = "lockdulu_admin";

test("admin access requires its own valid, unexpired session", async () => {
  const variables = { ADMIN_PASSWORD: password, SESSION_SECRET: secret, NODE_ENV: "production" };
  const admin = adminWith(variables);
  const seller = { value: admin.security.sellerSession("shop-id") };
  admin.stored.set(admin.security.sessionCookie, seller);
  assert.equal(await admin.currentAdmin(), false);
  assert.equal(await admin.signInAdmin("wrong password"), false);
  assert.equal(admin.stored.has(adminCookie), false);

  assert.equal(await admin.signInAdmin(password), true);
  const session = admin.stored.get(adminCookie);
  assert.equal(session.options.path, "/admin/dashboard");
  assert.equal(session.options.httpOnly, true);
  assert.equal(session.options.secure, true);
  assert.equal(await admin.currentAdmin(), true);
  admin.stored.set(adminCookie, { value: session.value.replace(/.$/, suffix => suffix === "0" ? "1" : "0") });
  assert.equal(await admin.currentAdmin(), false);
  admin.stored.set(adminCookie, session);

  variables.ADMIN_PASSWORD = "a new unique password";
  assert.equal(await admin.currentAdmin(), false);
  variables.ADMIN_PASSWORD = password;
  admin.advance(admin.security.sessionSeconds * 1_000);
  assert.equal(await admin.currentAdmin(), false);

  await admin.signInAdmin(password);
  await assert.rejects(admin.logoutAdmin(), /Redirect to \/admin\/dashboard/);
  assert.equal(admin.stored.get(adminCookie).options.maxAge, 0);
  assert.equal(await admin.currentAdmin(), false);
  assert.equal(admin.stored.get(admin.security.sessionCookie), seller);
});

test("admin login fails closed without configuration and limits incorrect attempts", async () => {
  const variables = { SESSION_SECRET: secret };
  const admin = adminWith(variables);
  const form = new FormData();
  form.set("password", password);
  assert.equal(await admin.loginAdmin("", form), "Admin sign-in is unavailable.");

  variables.ADMIN_PASSWORD = password;
  variables.SESSION_SECRET = "short";
  assert.equal(await admin.loginAdmin("", form), "Admin sign-in is unavailable.");
  variables.SESSION_SECRET = secret;
  form.set("password", "incorrect");
  for (let attempt = 0; attempt < 8; attempt++) {
    assert.equal(await admin.loginAdmin("", form), "Incorrect admin password.");
  }
  form.set("password", password);
  assert.match(await admin.loginAdmin("", form), /Too many sign-in attempts/);
  assert.equal(await admin.currentAdmin(), false);
  admin.advance(60_000);
  await assert.rejects(admin.loginAdmin("", form), /Redirect to \/admin\/dashboard/);
  assert.equal(await admin.currentAdmin(), true);
});
