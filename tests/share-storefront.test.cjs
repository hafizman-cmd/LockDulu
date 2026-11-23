const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync("components/share-storefront.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const component = {};
runInNewContext(source, { exports: component, require, URL });

function render(publicOrigin) {
  return renderToStaticMarkup(createElement(component.ShareStorefront, {
    storeSlug: "kakiselam.guni", publicOrigin,
  }));
}

test("sharing uses the public origin and the seller's storefront handle", () => {
  const markup = render("https://example.com/");
  assert.match(markup, /value="https:\/\/example\.com\/kakiselam\.guni"/);
  assert.match(markup, /Copy link/);
  assert.doesNotMatch(markup, /disabled/);
});

test("local links are labelled and copying waits for an available origin", () => {
  const markup = render("http://localhost:3000");
  assert.match(markup, /value="http:\/\/localhost:3000\/kakiselam\.guni"/);
  assert.match(markup, /local test link/);
  assert.match(render(undefined), /disabled/);
  assert.match(render("file:///invalid"), /disabled/);
});
