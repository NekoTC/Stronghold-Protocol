#!/usr/bin/env node
import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import COS from "cos-nodejs-sdk-v5";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const DATA = join(ROOT, "data");
const bucket = process.env.SP_OBJECT_STORAGE_BUCKET;
const region = process.env.SP_COS_REGION || "ap-shanghai";
const prefix = (process.env.SP_OBJECT_STORAGE_PREFIX || "").replace(/^\/+|\/+$/g, "");
const assetBase = (process.env.SP_ASSET_BASE_URL || "").replace(/\/$/, "");
const dataBase = (process.env.SP_DATA_BASE_URL || "").replace(/\/$/, "");
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const skipData = flags.has("--skip-data");
const dataOnly = flags.has("--data-only");

if (flags.has("--help") || flags.has("-h")) {
  console.log("Usage: node tools/upload-to-cos.mjs [OPTIONS]\n\nUpload game assets and data files to Tencent Cloud COS.\n\nOptions:\n  --dry-run     Show what would be uploaded\n  --skip-data   Upload only assets/fonts\n  --data-only   Upload only data files\n  -h, --help    Show this help\n\nRequired:\n  SP_OBJECT_STORAGE_BUCKET\n  TENCENTCLOUD_SECRET_ID\n  TENCENTCLOUD_SECRET_KEY\n\nOptional:\n  SP_COS_REGION (default: ap-shanghai)\n  SP_OBJECT_STORAGE_PREFIX\n  SP_ASSET_BASE_URL\n  SP_DATA_BASE_URL");
  process.exit(0);
}

if (!bucket) throw new Error("Set SP_OBJECT_STORAGE_BUCKET");
const accessKey = process.env.TENCENTCLOUD_SECRET_ID;
const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
if (!dryRun && (!accessKey || !secretKey)) {
  throw new Error("Set TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY");
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

const cos = dryRun ? null : new COS({ 
  SecretId: accessKey?.trim(), 
  SecretKey: secretKey?.trim(),
  Protocol: "https:",
  UseAccelerate: false
});

const jobs = [];

if (!dataOnly) {
  console.log("Collecting assets and fonts...");
  const publicFiles = await walk(PUBLIC);
  for (const file of publicFiles) {
    const rel = relative(PUBLIC, file).split(sep).join("/");
    if (!rel.startsWith("assets/") && !rel.startsWith("fonts/")) continue;
    const key = prefix ? prefix + "/" + rel : rel;
    jobs.push({ file, rel, key, size: (await stat(file)).size, type: "asset" });
  }
  console.log("Found " + jobs.length + " files");
}

if (!skipData) {
  console.log("Collecting data...");
  const dataFiles = await walk(DATA);
  const start = jobs.length;
  for (const file of dataFiles) {
    const rel = relative(DATA, file).split(sep).join("/");
    if (!rel.endsWith(".json")) continue;
    const key = (prefix ? prefix + "/" : "") + "data/" + rel;
    jobs.push({ file, rel: "data/" + rel, key, size: (await stat(file)).size, type: "data" });
  }
  console.log("Found " + (jobs.length - start) + " data files");
}

if (jobs.length === 0) {
  console.log("No files to upload");
  process.exit(0);
}

console.log("\nTarget: cos://" + bucket + "/" + (prefix || "(root)"));
console.log("Region: " + region);
console.log("Total: " + jobs.length + "\n");

if (dryRun) {
  for (const job of jobs) console.log("  " + job.rel + " -> " + job.key);
  process.exit(0);
}

let uploaded = 0;
let failed = 0;
const errors = [];

for (const job of jobs) {
  try {
    const body = await readFile(job.file);
    await new Promise((resolve, reject) => {
      cos.putObject({ 
        Bucket: bucket, 
        Region: region, 
        Key: job.key, 
        Body: body
      }, (err, data) => err ? reject(err) : resolve(data));
    });
    uploaded++;
    if (uploaded % 50 === 0 || uploaded === jobs.length) {
      console.log("[" + uploaded + "/" + jobs.length + "] " + job.rel);
    }
  } catch (err) {
    failed++;
    errors.push({ file: job.rel, error: err.message });
    console.error("[FAIL] " + job.rel + ": " + err.message);
  }
}

console.log("\nComplete: " + uploaded + " uploaded" + (failed > 0 ? ", " + failed + " failed" : ""));
if (errors.length > 0) {
  console.log("\nFailed files:");
  for (const e of errors) console.log("  " + e.file + ": " + e.error);
}
