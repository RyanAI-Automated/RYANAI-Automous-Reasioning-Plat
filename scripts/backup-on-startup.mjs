#!/usr/bin/env node
/**
 * Optional, non-blocking startup backup.
 * Requires BACKUP_ON_STARTUP=true, DATABASE_URL, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and an existing private SUPABASE_BACKUP_BUCKET.
 * Never serializes secret values or logs credentials.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const log = (message) => console.log("[startup-backup] " + message);
const warn = (message) => console.error("[startup-backup] WARNING: " + message);

function pgDump(file) {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", file, process.env.DATABASE_URL], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("pg_dump exited " + code + ": " + stderr.slice(-1000))));
  });
}

async function request(url, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(url, {
    ...options,
    headers: { apikey: key, Authorization: "Bearer " + key, ...(options.headers || {}) },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error("Supabase Storage HTTP " + response.status + ": " + (await response.text()).slice(0, 300));
  return response;
}

async function copyBucket(baseUrl, sourceBucket, targetBucket, prefix) {
  async function walk(folder) {
    let offset = 0;
    while (true) {
      const listing = await request(baseUrl + "/storage/v1/object/list/" + encodeURIComponent(sourceBucket), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: folder, limit: 100, offset }),
      });
      const entries = await listing.json();
      if (!Array.isArray(entries)) throw new Error("Invalid Storage listing for " + sourceBucket);
      for (const entry of entries) {
        const objectPath = folder ? folder + "/" + entry.name : entry.name;
        if (!entry.id && !entry.metadata) {
          await walk(objectPath);
        } else {
          const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
          const fileResponse = await request(baseUrl + "/storage/v1/object/authenticated/" + encodeURIComponent(sourceBucket) + "/" + encoded);
          const bytes = Buffer.from(await fileResponse.arrayBuffer());
          await request(baseUrl + "/storage/v1/object/" + encodeURIComponent(targetBucket) + "/" + (prefix + "/storage/" + sourceBucket + "/" + objectPath).split("/").map(encodeURIComponent).join("/"), {
            method: "POST",
            headers: { "Content-Type": (entry.metadata && entry.metadata.mimetype) || "application/octet-stream", "x-upsert": "true" },
            body: bytes,
          });
        }
      }
      if (entries.length < 100) break;
      offset += entries.length;
    }
  }
  await walk("");
}

async function main() {
  if (process.env.BACKUP_ON_STARTUP !== "true") {
    log("disabled; set BACKUP_ON_STARTUP=true to enable");
    return;
  }
  const required = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BACKUP_BUCKET"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    warn("skipped; missing environment variable(s): " + missing.join(", "));
    return;
  }

  const baseUrl = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const destination = process.env.SUPABASE_BACKUP_BUCKET;
  const sources = (process.env.RYANAI_BACKUP_STORAGE_BUCKETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (sources.includes(destination)) {
    warn("skipped; destination bucket must not also be a source bucket");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
  const prefix = "ryanai-startup/" + stamp;
  const temp = await mkdtemp(path.join(tmpdir(), "ryanai-backup-"));
  try {
    const dumpPath = path.join(temp, "database.dump");
    await pgDump(dumpPath);
    const dump = await readFile(dumpPath);
    await request(baseUrl + "/storage/v1/object/" + encodeURIComponent(destination) + "/" + prefix + "/database.dump", {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "x-upsert": "true" }, body: dump,
    });

    const safeKeys = ["NODE_ENV", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "DATABASE_URL", "REDIS_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NVIDIA_API_KEY", "QWEN_API_KEY", "LOGIC_API_KEY", "OPENAI_API_KEY", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "SMTP_PASS"];
    const presence = Object.fromEntries(safeKeys.map((key) => [key, Boolean(process.env[key])]));
    const manifest = {
      format: "ryanai-startup-backup-v1",
      createdAt: new Date().toISOString(),
      gitCommit: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || null,
      renderServiceId: process.env.RENDER_SERVICE_ID || null,
      databaseDump: "database.dump (pg_dump custom format; schema and data)",
      storageBuckets: sources,
      environmentVariablePresence: presence,
      secretsIncluded: false,
      retention: "No automatic deletion; configure private-bucket lifecycle/retention separately.",
    };
    await request(baseUrl + "/storage/v1/object/" + encodeURIComponent(destination) + "/" + prefix + "/manifest.json", {
      method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "true" }, body: JSON.stringify(manifest, null, 2),
    });
    for (const source of sources) await copyBucket(baseUrl, source, destination, prefix);
    log("completed: private bucket " + destination + ", object prefix " + prefix);
  } catch (error) {
    warn("backup failed; API startup will continue: " + error.message);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => warn("unexpected failure; API startup will continue: " + error.message));
