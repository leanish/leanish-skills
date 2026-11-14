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

// Expression string literals are single-quoted, with '' for a quote. The index just past the literal opening at
// `start`, or the text's length when it never closes.
function literalEnd(text, start) {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] !== "'") continue;
    if (text[index + 1] === "'") index++;
    else return index + 1;
  }
  return text.length;
}

// The expressions in a workflow value: each `${{ ... }}` (a `}}` inside a string literal doesn't close it), and for a
// job or step `if:` condition, which is an expression even unwrapped, the whole value when nothing is wrapped.
function expressionsIn(value, isCondition) {
  const expressions = [];
  for (let open = value.indexOf("${{"); open !== -1; open = value.indexOf("${{", open)) {
    let index = open + 3;
    while (index < value.length && !value.startsWith("}}", index)) {
      index = value[index] === "'" ? literalEnd(value, index) : index + 1;
    }
    expressions.push(value.slice(open + 3, index));
    open = index + 2;
  }
  return isCondition && expressions.length === 0 ? [value] : expressions;
}

// Where the expression's string literals are, so a `secrets.X` written inside one isn't taken for a reference.
function literalRanges(expression) {
  const ranges = [];
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] !== "'") continue;
    const end = literalEnd(expression, index);
    ranges.push([index, end]);
    index = end - 1;
  }
  return ranges;
}

// The secrets context, case-insensitive like every expression context: `secrets.NAME` or `secrets['NAME']` names one;
// an index that isn't a literal is "(dynamic)", and the whole context (e.g. toJSON(secrets)) is "(all)".
const SECRETS_REFERENCE = /(?<![\w.-])secrets\b(?:\s*\.\s*([A-Za-z_][\w-]*)|\s*\[\s*(?:'([^']*)'|"([^"]*)"|([^\]]*))\s*\])?/gi;

function secretsIn(job) {
  const names = new Set();
  function visit(value, isCondition = false) {
    if (typeof value === "string") {
      for (const expression of expressionsIn(value, isCondition)) {
        const literals = literalRanges(expression);
        for (const match of expression.matchAll(SECRETS_REFERENCE)) {
          if (literals.some(([start, end]) => match.index >= start && match.index < end)) continue;
          const literal = match[1] ?? match[2] ?? match[3];
          names.add(literal ?? (match[4] !== undefined ? "(dynamic)" : "(all)"));
        }
      }
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  }
  // Only a job's and a step's `if:` are conditions; an `if` elsewhere (an action input, say) is plain text.
  for (const [key, value] of Object.entries(job)) {
    if (key === "steps" && Array.isArray(value)) {
      for (const step of value) {
        if (step && typeof step === "object" && !Array.isArray(step)) {
          for (const [stepKey, stepValue] of Object.entries(step)) visit(stepValue, stepKey === "if");
        } else {
          visit(step);
        }
      }
    } else {
      visit(value, key === "if");
    }
  }
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
