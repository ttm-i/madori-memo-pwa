import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const forbidden = [
  "room_measurements",
  "無題38_",
  "間取り寸法（",
  "リビング窓１",
  "洋室クローゼット",
  "新居・実測間取り",
  "263.5",
];

// GitHub Pagesへ送ってよいファイルを明示的に限定する。
// 公開アセットを追加した場合は、内容を確認してからこの一覧も更新する。
const allowedFiles = new Set([
  "app.js",
  "db.js",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "model.js",
  "renderer.js",
  "styles.css",
  "sw.js",
  "three.js",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

const textExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".webmanifest"]);
const matches = [];
const files = await walk(dist);
for (const file of files) {
  const publicPath = relative(dist, file).replaceAll("\\", "/");
  if (publicPath.includes("/") || !allowedFiles.has(basename(file))) {
    matches.push(`${publicPath}: 公開許可リストにないファイル`);
  }
  if (!textExtensions.has(extname(file))) continue;
  const content = await readFile(file, "utf8");
  for (const token of forbidden) if (content.includes(token)) matches.push(`${file}: ${token}`);
}

if (matches.length) {
  console.error("Private-data boundary check failed:\n" + matches.join("\n"));
  process.exit(1);
}
console.log(`Public boundary check passed: ${files.length} approved files and no private source markers in dist/.`);

