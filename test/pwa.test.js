import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("offline app shell contains existing assets from one version", () => {
  const distUrl = new URL("../dist/", import.meta.url);
  const serviceWorker = readFileSync(new URL("sw.js", distUrl), "utf8");
  const version = serviceWorker.match(/floor-plan-shell-v(\d+)/)?.[1];
  assert.ok(version);

  const shellBlock = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] ?? "";
  const entries = [...shellBlock.matchAll(/"\.\/(.*?)"/g)].map((match) => match[1]);
  assert.ok(entries.length >= 9);
  for (const entry of entries) {
    const [pathname, query = ""] = entry.split("?");
    assert.equal(existsSync(fileURLToPath(new URL(pathname || "index.html", distUrl))), true, `${pathname} must exist`);
    if (query) assert.equal(query, `v=${version}`, `${entry} must match cache version ${version}`);
  }

  for (const filename of ["index.html", "app.js", "renderer.js", "three.js"]) {
    const source = readFileSync(new URL(filename, distUrl), "utf8");
    for (const match of source.matchAll(/[?&]v=(\d+)/g)) {
      assert.equal(match[1], version, `${filename} must use cache version ${version}`);
    }
  }
});
