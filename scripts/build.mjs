import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publishDirectory = join(projectRoot, "dist");
const publicFiles = [
  "index.html",
  "admin.html",
  "responses.html",
  "app.js",
  "admin.js",
  "responses.js",
  "styles.css",
];

await rm(publishDirectory, { recursive: true, force: true });
await mkdir(publishDirectory, { recursive: true });
await Promise.all(publicFiles.map((file) => copyFile(join(projectRoot, file), join(publishDirectory, file))));
console.log(`Prepared ${publicFiles.length} frontend files for Netlify.`);