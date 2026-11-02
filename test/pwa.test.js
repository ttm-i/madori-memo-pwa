import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("offline app shell contains existing assets from one version", () => {
  const distUrl = new URL("../dist/", import.meta.url);
  const serviceWorker = readFileSync(new URL("sw.js", distUrl), "utf8");
  const version = serviceWorker.match(/floor-plan(?:-webgl)?-shell-v(\d+)/)?.[1];
  assert.ok(version);

  const shellBlock = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] ?? "";
  const entries = [...shellBlock.matchAll(/"\.\/(.*?)"/g)].map((match) => match[1]);
  assert.ok(entries.length >= 9);
  for (const entry of entries) {
    const [pathname, query = ""] = entry.split("?");
    assert.equal(existsSync(fileURLToPath(new URL(pathname || "index.html", distUrl))), true, `${pathname} must exist`);
    if (query) assert.equal(query, `v=${version}`, `${entry} must match cache version ${version}`);
  }

  for (const filename of ["index.html", "app.js", "renderer.js", "three.js", "webgl-three.js"]) {
    const source = readFileSync(new URL(filename, distUrl), "utf8");
    for (const match of source.matchAll(/[?&]v=(\d+)/g)) {
      assert.equal(match[1], version, `${filename} must use cache version ${version}`);
    }
  }
});

test("the redundant current-plan summary stays out of the 2D layout", () => {
  const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<section class="summary-card"[^>]*\bhidden\b/);
});

test("the WebGL prototype stays local-first and isolated from the stable database", () => {
  const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const webgl = readFileSync(new URL("../dist/webgl-three.js", import.meta.url), "utf8");
  const database = readFileSync(new URL("../dist/db.js", import.meta.url), "utf8");

  assert.match(html, /<canvas[^>]+id="threeCanvas"/);
  assert.match(webgl, /from "\.\/vendor\/three\/three\.module\.js"/);
  assert.doesNotMatch(webgl, /https?:\/\//);
  assert.match(database, /floor-plan-webgl-private/);
  assert.doesNotMatch(database, /const DB_NAME = "floor-plan-private"/);
});
