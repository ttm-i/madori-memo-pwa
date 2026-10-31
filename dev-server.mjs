import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const port = Number(process.argv[2] ?? 4178);

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = normalize(join(root, relative));
  if (!target.startsWith(normalize(root)) || !existsSync(target) || statSync(target).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(target).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`Local URL: http://127.0.0.1:${port}`));

