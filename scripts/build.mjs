import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const client = resolve(dist, "client");
const server = resolve(dist, "server");
const NON_DEPLOYABLE_BASENAMES = new Set(["raw-sheet.png", "raw-sheet-clean.png", "animation.gif"]);

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

function deployableAsset(source) {
  if (NON_DEPLOYABLE_BASENAMES.has(basename(source))) return false;
  const normalized = relative(root, source).replaceAll("\\", "/");
  if (!normalized.includes("/actions/")) return true;
  if (!extname(source)) return true;
  if (normalized.endsWith("/actions/character-scale-profile.json")) return true;
  const match = normalized.match(/\/actions\/([^/]+)\/([^/]+)-(\d+)\.png$/);
  return Boolean(match && match[1] === match[2]);
}

for (const entry of ["index.html", "style.css", "src"]) {
  await cp(resolve(root, entry), resolve(client, entry), { recursive: true });
}
await cp(resolve(root, "assets"), resolve(client, "assets"), { recursive: true, filter: deployableAsset });
await cp(resolve(root, ".openai"), resolve(dist, ".openai"), { recursive: true });

const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const url = new URL(request.url);
    if (url.pathname.includes(".")) return response;
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
`;

await writeFile(resolve(server, "index.js"), worker, "utf8");
console.log("Static Sites build created in dist/.");
