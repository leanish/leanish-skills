#!/usr/bin/env node
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadYaml() {
  try {
    return await import("yaml");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  // ESM does not search cwd or NODE_PATH; CommonJS resolution does.
  const require = createRequire(join(process.cwd(), "audit-loader.cjs"));
  try {
    return await import(pathToFileURL(require.resolve("yaml")).href);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error('yaml is required: run from a directory with "yaml" installed or set NODE_PATH to its node_modules directory.', { cause: error });
  }
}

export function triggersOf(on) {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

function describePermissions(permissions) {
  if (permissions === undefined) return "(unset: repo default)";
  if (typeof permissions === "string") return permissions;
  return Object.entries(permissions).map(([scope, level]) => `${scope}:${level}`).join(",") || "none";
}

function writesOf(permissions) {
  if (permissions === undefined) return "default";
  if (typeof permissions === "string") return permissions === "write-all" ? "write-all" : "";
  return Object.entries(permissions).filter(([, level]) => level === "write").map(([scope]) => scope).join(",");
}

function secretsIn(job) {
  const names = new Set();
  function visit(value) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/secrets(?:\.([A-Za-z0-9_]+)|\[['"]([^'"\]]+)['"]\])/g)) names.add(match[1] ?? match[2]);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  }
  visit(job);
  if (job.secrets === "inherit") names.add("(inherit)");
  else if (job.secrets && typeof job.secrets === "object") {
    for (const name of Object.keys(job.secrets)) names.add(`passed:${name}`);
  }
  return [...names].join(",");
}

function describeUse(ref) {
  const external = !ref.startsWith("./");
  return ref + (external && !/@[0-9a-f]{40}$/i.test(ref) ? " (unpinned)" : "");
}

export function auditWorkflow(workflow, repo, file) {
  const triggers = triggersOf(workflow.on ?? workflow[true]).join(",");
  return Object.entries(workflow.jobs ?? {}).map(([name, job]) => {
    const permissions = job.permissions ?? workflow.permissions;
    const steps = job.steps ?? [];
    const checkouts = steps.filter((step) => typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"))
      .map((step) => step.with?.["persist-credentials"] === false || step.with?.["persist-credentials"] === "false" ? "no-persist" : "persist");
    // Inline shell can execute repository code; this is a candidate signal, not a verdict.
    const runsRepoCode = steps.some((step) => step.run !== undefined || step.uses?.startsWith("./"));
    const uses = [job.uses, ...steps.map((step) => step.uses)].filter((ref) => typeof ref === "string");
    return [repo, file, name, triggers, describePermissions(permissions), writesOf(permissions), secretsIn(job),
      checkouts.join(","), runsRepoCode ? "yes" : "", uses.map(describeUse).join(",")];
  });
}

export function auditDirectory(root, parse) {
  const rows = [["repo", "workflow", "job", "triggers", "permissions", "writes", "secrets", "checkouts", "runsRepoCode", "uses"]];
  for (const repo of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const file of readdirSync(join(root, repo.name), { withFileTypes: true }).filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(root, repo.name, file.name);
      try {
        const workflow = parse(readFileSync(path, "utf8"));
        if (!workflow || typeof workflow !== "object") throw new Error("expected a workflow mapping");
        rows.push(...auditWorkflow(workflow, repo.name, file.name));
      } catch (error) {
        throw new Error(`${path}: ${error.message}`, { cause: error });
      }
    }
  }
  return rows.map((row) => row.map((cell) => String(cell).replace(/[\t\r\n]/g, " ")).join("\t")).join("\n");
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error("usage: audit.mjs <dir>");
    process.exitCode = 1;
  } else {
    let yaml;
    try {
      yaml = await loadYaml();
    } catch (error) {
      console.error(error.message);
      process.exitCode = error.cause?.code === "MODULE_NOT_FOUND" ? 2 : 1;
    }
    if (yaml) {
      try {
        console.log(auditDirectory(process.argv[2], yaml.parse));
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
}
