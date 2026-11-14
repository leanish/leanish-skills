import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDirectory, auditWorkflow, loadYaml, triggersOf } from "./audit.mjs";
import { harden } from "./harden.mjs";

const SCRIPT = fileURLToPath(new URL("audit.mjs", import.meta.url));
const SHA = "b".repeat(40);
let yaml;
try {
  yaml = await loadYaml();
} catch (error) {
  if (error.cause?.code !== "MODULE_NOT_FOUND") throw error;
}
// `npm test` (and CI) installs yaml, so there a missing parser fails instead of silently skipping half the tests.
if (!yaml && process.env.npm_lifecycle_event === "test") {
  throw new Error("yaml is required by npm test: run npm ci first");
}
const yamlOptions = { skip: yaml ? false : 'yaml is not resolvable; run with yaml installed in cwd or set NODE_PATH' };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "audit-workflows-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const [name, value] of [["string", "push"], ["list", "[push, pull_request]"], ["map", "{push: {}, workflow_dispatch: {}}"]]) {
  test(`reads on: as a ${name}`, yamlOptions, () => {
    const source = `on: ${value}\njobs:\n  build:\n    steps: []\n`;
    const [row] = auditWorkflow(yaml.parse(source), "repo", "ci.yml");
    assert.equal(row[3], name === "string" ? "push" : name === "list" ? "push,pull_request" : "push,workflow_dispatch");
  });
}

test("accepts a boolean true trigger key from YAML 1.1 parsers", () => {
  const [row] = auditWorkflow({ true: { push: null, schedule: [] }, jobs: { build: {} } }, "repo", "ci.yml");
  assert.equal(row[3], "push,schedule");
  assert.deepEqual(triggersOf(["push", "pull_request"]), ["push", "pull_request"]);
});

test("job permissions replace workflow permissions; missing defaults remain visible", () => {
  const rows = auditWorkflow({ permissions: { contents: "read", packages: "write" }, jobs: {
    inherited: {}, narrowed: { permissions: { contents: "read" } }, none: { permissions: {} },
    read: { permissions: "read-all" }, write: { permissions: "write-all" },
  } }, "repo", "ci.yml");
  assert.deepEqual(rows.map((row) => row.slice(4, 6)), [
    ["contents:read,packages:write", "packages"], ["contents:read", ""], ["none", ""], ["read-all", ""], ["write-all", "write-all"],
  ]);
  const [unset] = auditWorkflow({ jobs: { build: {} } }, "repo", "ci.yml");
  assert.deepEqual(unset.slice(4, 6), ["(unset: repo default)", "default"]);
});

test("shows reusable workflows, inherited secrets and explicitly passed secrets", yamlOptions, () => {
  const rows = auditWorkflow(yaml.parse(`on: workflow_call
jobs:
  reusable:
    uses: owner/repo/.github/workflows/build.yml@main
    secrets: inherit
  pinned:
    uses: owner/repo/.github/workflows/build.yml@${SHA}
    secrets:
      token: \${{ secrets.RELEASE_TOKEN }}
`), "repo", "ci.yml");
  assert.equal(rows[0][6], "(inherit)");
  assert.equal(rows[0][9], "owner/repo/.github/workflows/build.yml@main (unpinned)");
  assert.equal(rows[1][6], "RELEASE_TOKEN,passed:token");
  assert.equal(rows[1][9], `owner/repo/.github/workflows/build.yml@${SHA}`);
});

test("marks checkout persistence and every floating external use", () => {
  const [row] = auditWorkflow({ jobs: { build: { steps: [
    { uses: "actions/checkout@v7" },
    { uses: `actions/checkout@${SHA}`, with: { "persist-credentials": false } },
    { uses: `actions/checkout@${SHA}`, with: { "persist-credentials": "false" } },
    { uses: `actions/setup-java@${SHA.slice(0, 7)}` },
    { uses: "vendor/action@" + "C".repeat(40) },
    { uses: "./.github/actions/local" },
    { uses: "docker://alpine:latest" },
  ] } } }, "repo", "ci.yml");
  assert.equal(row[7], "persist,no-persist,no-persist");
  assert.equal(row[8], "yes");
  assert.ok(row[9].includes("actions/checkout@v7 (unpinned)"));
  assert.ok(row[9].includes(`actions/setup-java@${SHA.slice(0, 7)} (unpinned)`));
  assert.ok(!row[9].includes(`${SHA} (unpinned)`));
  assert.ok(!row[9].includes(`${"C".repeat(40)} (unpinned)`));
  assert.ok(!row[9].includes("local (unpinned)"));
  assert.ok(row[9].includes("docker://alpine:latest (unpinned)"));
});

test("marks run steps and deduplicates secrets across a job", () => {
  const [row] = auditWorkflow({ jobs: { build: { steps: [
    { run: "npm test", env: { TOKEN: "${{ secrets.TOKEN }}", AGAIN: "${{ secrets.TOKEN }}", OTHER: "${{ secrets['OTHER'] }}", THIRD: '${{ secrets["THIRD"] }}' } },
  ] } } }, "repo", "ci.yml");
  assert.equal(row[6], "TOKEN,OTHER,THIRD");
  assert.equal(row[8], "yes");
});

test("reads secret references inside expressions only, in every supported form", () => {
  const [row] = auditWorkflow({ jobs: { build: {
    if: "secrets.CONDITION != ''",
    steps: [
      { run: "echo secrets.NOT_AN_EXPRESSION", env: {
        SPACED: "${{ secrets[ 'SPACED' ] }}",
        CASED: "${{ Secrets.CASED }}",
        DYNAMIC: "${{ secrets[matrix.secret] }}",
        ALL: "${{ toJSON(secrets) }}",
        TWO: "${{ secrets.FIRST || secrets.SECOND }}",
        OTHER_CONTEXT: "${{ github.secrets }}",
      } },
    ],
  } } }, "repo", "ci.yml");
  assert.equal(row[6], "CONDITION,SPACED,CASED,(dynamic),(all),FIRST,SECOND");
});

test("ignores secrets mentioned in string literals and if: outside job and step conditions", () => {
  const [row] = auditWorkflow({ jobs: { build: {
    steps: [
      { if: "secrets.STEP_CONDITION != ''", uses: "owner/action@v1", with: {
        if: "secrets.ACTION_INPUT",
        LITERAL: "${{ format('secrets.NOT_A_REFERENCE') }}",
        CLOSING: "${{ format('}}{0}', secrets.AFTER_CLOSING) }}",
        QUOTE: "${{ format('it''s', secrets.AFTER_QUOTE) }}",
        BRACKET: "${{ secrets['BRACKET'] }}",
      } },
    ],
  } } }, "repo", "ci.yml");
  assert.equal(row[6], "STEP_CONDITION,AFTER_CLOSING,AFTER_QUOTE,BRACKET");
});

test("hardened YAML parses and no longer reports persistence or floating pins", yamlOptions, () => {
  const ref = `actions/checkout@${SHA}`;
  const source = "on: push\npermissions: {contents: read}\njobs:\n  build:\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v7\n        with: # retain comment\n          fetch-depth: 0\n      - run: npm test\n";
  const parsed = yaml.parse(harden(source, { "actions/checkout@v7": `${ref} # v7` }));
  const [row] = auditWorkflow(parsed, "repo", "ci.yml");
  assert.equal(row[7], "no-persist");
  assert.equal(row[9], ref);
  assert.equal(parsed.jobs.build.steps[0].with["fetch-depth"], 0);
});

test("CLI prints a header and one TSV row per job, ignoring non-workflow files", yamlOptions, (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "repo"));
  mkdirSync(join(dir, "repo", "subdir"));
  writeFileSync(join(dir, "notes.txt"), "ignore");
  writeFileSync(join(dir, "repo", "README.md"), "ignore");
  writeFileSync(join(dir, "repo", "ci.yaml"), "on: push\njobs:\n  build:\n    steps:\n      - run: npm test\n  reusable:\n    uses: owner/repo/.github/workflows/build.yml@main\n    secrets: inherit\n");
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trimEnd().split("\n").map((line) => line.split("\t"));
  assert.deepEqual(rows[0], ["repo", "workflow", "job", "triggers", "permissions", "writes", "secrets", "checkouts", "runsRepoCode", "uses"]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.length === 10));
  assert.deepEqual(rows[1].slice(0, 6), ["repo", "ci.yaml", "build", "push", "(unset: repo default)", "default"]);
});

test("reports invalid YAML with its path without printing a partial report", yamlOptions, (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "repo"));
  const path = join(dir, "repo", "bad.yml");
  writeFileSync(path, "jobs: [\n");
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(path));
  assert.equal(result.stdout, "");
});

test("escapes cell control characters to keep the TSV rectangular", (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "repo"));
  writeFileSync(join(dir, "repo", "ci.yml"), "");
  const output = auditDirectory(dir, () => ({ jobs: { "job\nname": { permissions: "read-all\tbad" } } }));
  assert.equal(output.split("\n").length, 2);
  assert.equal(output.split("\n")[1].split("\t").length, 10);
});

test("missing yaml exits 2 with one actionable line", (t) => {
  const dir = fixture(t);
  const copy = join(dir, "audit.mjs");
  copyFileSync(SCRIPT, copy);
  const result = spawnSync(process.execPath, ["--no-global-search-paths", copy, dir], {
    cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim().split("\n").length, 1);
  assert.match(result.stderr, /yaml.*directory.*installed.*NODE_PATH/);
});
