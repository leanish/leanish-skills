import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { harden } from "./harden.mjs";

const SCRIPT = fileURLToPath(new URL("harden.mjs", import.meta.url));
const FETCH = fileURLToPath(new URL("fetch-workflows.sh", import.meta.url));
const SHA = "a".repeat(40);
const PINS = { "actions/checkout@v7": `actions/checkout@${SHA} # v7.0.1`, "actions/setup-java@v6": `actions/setup-java@${SHA} # v6.1.0` };
const workflow = (steps) => `# keep this\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "harden-workflows-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const named of [false, true]) {
  for (const withInputs of [false, true]) {
    test(`hardens ${named ? "named" : "uses-first"} checkout ${withInputs ? "with" : "without"} inputs`, () => {
      const head = named ? "      - name: Checkout # keep name\n        uses: actions/checkout@v7\n" : "      - uses: actions/checkout@v7\n";
      const inputs = withInputs ? "        with: # keep inputs\n          fetch-depth: 0 # keep depth\n" : "";
      const tail = "      - run: npm test\n";
      const source = workflow(head + inputs + tail);
      const expected = workflow(head.replace("actions/checkout@v7", PINS["actions/checkout@v7"]) +
        (withInputs ? "        with: # keep inputs\n          persist-credentials: false\n          fetch-depth: 0 # keep depth\n" : "        with:\n          persist-credentials: false\n") + tail);
      assert.equal(harden(source, PINS), expected);
    });
  }
}

test("finds with: before uses: and preserves its indentation", () => {
  const source = workflow("      - name: Checkout\n        with:\n            fetch-depth: 0\n        uses: actions/checkout@v7\n");
  assert.equal(harden(source, {}), source.replace("        with:\n", "        with:\n            persist-credentials: false\n"));
});

test("does not borrow inputs from the following checkout", () => {
  const source = workflow("      - uses: actions/checkout@v7\n      - uses: actions/checkout@v7\n        with:\n          path: second\n");
  const result = harden(source, {});
  assert.equal(result.match(/persist-credentials: false/g).length, 2);
  assert.ok(result.includes("with:\n          persist-credentials: false\n          path: second"));
});

test("pins steps and reusable jobs, retains quoted refs and leaves unmapped refs alone", () => {
  const source = workflow("      - uses: 'actions/setup-java@v6'\n      - uses: vendor/unmapped@v2\n") +
    "  reusable:\n    uses: vendor/repo/.github/workflows/build.yml@v1\n    secrets: inherit\n";
  const pins = { ...PINS, "vendor/repo/.github/workflows/build.yml@v1": `vendor/repo/.github/workflows/build.yml@${SHA} # v1` };
  const expected = source.replace("'actions/setup-java@v6'", `'actions/setup-java@${SHA}' # v6.1.0`)
    .replace("vendor/repo/.github/workflows/build.yml@v1", pins["vendor/repo/.github/workflows/build.yml@v1"]);
  assert.equal(harden(source, pins), expected);
});

test("preserves CRLF, missing final newline, comments and shell block contents", () => {
  const source = workflow("      - run: |\n          uses: actions/checkout@v7\n          # do not edit shell\n      - uses: actions/checkout@v7").replaceAll("\n", "\r\n");
  const expected = source.replace(/      - uses: actions\/checkout@v7$/, `      - uses: ${PINS["actions/checkout@v7"]}\r\n        with:\r\n          persist-credentials: false`);
  assert.equal(harden(source, PINS), expected);
});

test("leaves a block scalar alone when its header has trailing whitespace", () => {
  const source = workflow("      - run: |  \n          cat <<'EOF'\n          uses: actions/setup-java@v6\n          EOF\n      - uses: actions/setup-java@v6\n");
  const expected = source.replace("      - uses: actions/setup-java@v6\n", `      - uses: ${PINS["actions/setup-java@v6"]}\n`);
  assert.equal(harden(source, PINS), expected);
});

test("leaves a block scalar sequence item alone", () => {
  const source = workflow("      - run: echo\n        env:\n          LIST: x\n      - uses: actions/setup-java@v6\n") +
    "    services:\n      - |\n        uses: actions/setup-java@v6\n";
  const expected = source.replace("      - uses: actions/setup-java@v6\n", `      - uses: ${PINS["actions/setup-java@v6"]}\n`);
  assert.equal(harden(source, PINS), expected);
});

for (const [kind, open, close] of [["double", '"', '"'], ["single", "'", "'"]]) {
  test(`leaves a multiline ${kind}-quoted scalar alone`, () => {
    const body = kind === "double" ? 'echo \\"one\n          uses: actions/setup-java@v6\n          two\\"' : "echo ''one\n          uses: actions/setup-java@v6\n          two''";
    const source = workflow(`      - run: ${open}${body}${close}\n      - uses: actions/setup-java@v6\n`);
    const expected = source.replace("      - uses: actions/setup-java@v6\n", `      - uses: ${PINS["actions/setup-java@v6"]}\n`);
    assert.equal(harden(source, PINS), expected);
  });
}

test("supports indentless step sequences and already-pinned checkout refs", () => {
  const source = `jobs:\n  build:\n    steps:\n    - uses: actions/checkout@${SHA} # v7\n`;
  assert.equal(harden(source, {}), source + "      with:\n        persist-credentials: false\n");
});

test("recognizes checkout after a block scalar step name", () => {
  const source = workflow("      - name: |\n          Checkout\n        uses: actions/checkout@v7\n");
  assert.equal(harden(source, {}), source + "        with:\n          persist-credentials: false\n");
});

test("leaves unchanged files byte-for-byte and prints only changed paths", (t) => {
  const dir = fixture(t);
  const pins = join(dir, "pins.json");
  const changed = join(dir, "changed.yml");
  const untouched = join(dir, "untouched.yml");
  writeFileSync(pins, JSON.stringify(PINS));
  writeFileSync(changed, workflow("      - uses: actions/checkout@v7\n"));
  const original = workflow(`      - uses: actions/setup-java@${SHA} # v6\n`);
  writeFileSync(untouched, original);
  const result = spawnSync(process.execPath, [SCRIPT, "--pins", pins, changed, untouched], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `changed ${changed}\n`);
  assert.ok(readFileSync(changed, "utf8").includes("persist-credentials: false"));
  assert.equal(readFileSync(untouched, "utf8"), original);
});

const refusals = [
  ["commented floating ref", "      - uses: actions/setup-java@v6 # deliberate\n", /commented tag/],
  ["existing false input", "      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n", /already sets persist-credentials/],
  ["existing true input before uses", "      - with:\n          persist-credentials: true\n        uses: actions/checkout@v7\n", /already sets persist-credentials/],
  ["flow inputs", "      - uses: actions/checkout@v7\n        with: {fetch-depth: 0}\n", /block mapping/],
  ["flow step", "      - {uses: actions/checkout@v7}\n", /unsupported/],
  ["flow steps", "      [{uses: actions/checkout@v7}]\n", /unsupported/],
  ["aliased inputs", "      - uses: actions/checkout@v7\n        with: *inputs\n", /block mapping/],
  ["folded uses scalar", "      - uses: >-\n          actions/checkout@v7\n", /unsupported uses scalar/],
  ["aliased uses scalar", "      - uses: *checkout\n", /unsupported uses scalar/],
  ["merged step", "      - uses: actions/checkout@v7\n        <<: *defaults\n", /ambiguous/],
  ["merged inputs", "      - uses: actions/checkout@v7\n        with:\n          <<: *inputs\n", /ambiguous/],
  ["duplicate inputs", "      - uses: actions/checkout@v7\n        with:\n          ref: main\n        with:\n          path: other\n", /ambiguous/],
  ["uneven step indentation", "      - name: checkout\n         uses: actions/checkout@v7\n", /ambiguous/],
];
for (const [name, steps, error] of refusals) {
  test(`refuses ${name} without writing earlier edits in the same file`, (t) => {
    const dir = fixture(t);
    const pins = join(dir, "pins.json");
    const path = join(dir, "build.yml");
    const source = workflow("      - uses: actions/setup-java@v6\n" + steps);
    writeFileSync(pins, JSON.stringify(PINS));
    writeFileSync(path, source);
    const result = spawnSync(process.execPath, [SCRIPT, "--pins", pins, path], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
    assert.equal(result.stdout, "");
    assert.equal(readFileSync(path, "utf8"), source);
  });
}

test("refuses flow steps on the steps: line", () => {
  assert.throws(() => harden("jobs:\n  build:\n    steps: [{uses: actions/checkout@v7}]\n", PINS), /unsupported flow/);
});

test("rejects malformed pins and CLI arguments", () => {
  const source = workflow("      - uses: actions/checkout@v7\n");
  for (const pins of [null, [], { "actions/checkout@v7": "actions/checkout@short" }, { "actions/checkout@v7": `other/action@${SHA}` }]) {
    assert.throws(() => harden(source, pins), /pins must|invalid pin/);
  }
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage:/);
});

function mockGh(t) {
  const dir = fixture(t);
  const log = join(dir, "gh.log");
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
const endpoint = args[1];
if (endpoint === "graphql") console.log("live\\nempty\\narchived");
else if (/repos\\/owner\\/[^/]+$/.test(endpoint)) console.log(endpoint.endsWith("/archived") ? "true" : "false");
else if (endpoint.endsWith("/workflows")) {
  if (endpoint.includes("/empty/")) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }
  if (process.env.GH_FAIL) { console.error("gh: forbidden (HTTP 403)"); process.exit(1); }
  console.log("ci.yml\\nci.yml\\nrelease flow.yaml\\nrelease%20flow.yaml");
} else if (endpoint.endsWith("/ci.yml") || endpoint.endsWith("/release%20flow.yaml")) process.stdout.write("on: push\\njobs: {}\\n");
else { console.error("unexpected call: " + args); process.exit(1); }
`);
  chmodSync(gh, 0o755);
  return { dir, log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_LOG: log } };
}

test("fetch discovers all pages, skips archived/missing workflows and saves raw YAML", (t) => {
  const mock = mockGh(t);
  const out = join(mock.dir, "out");
  const result = spawnSync("bash", [FETCH, "owner", out], { encoding: "utf8", env: mock.env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(out, "live", "ci.yml"), "utf8"), "on: push\njobs: {}\n");
  assert.equal(readFileSync(join(out, "live", "release flow.yaml"), "utf8"), "on: push\njobs: {}\n");
  const calls = readFileSync(mock.log, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls[0].includes("--paginate"));
  assert.ok(calls[0].some((arg) => arg.includes("isArchived: false")));
  assert.ok(!calls.some((args) => args[1].includes("/archived/contents")));
  assert.ok(calls.some((args) => args.includes("Accept: application/vnd.github.raw+json")));
});

test("fetch scopes explicit repositories and refuses even hidden existing output before gh", (t) => {
  const mock = mockGh(t);
  const out = join(mock.dir, "out");
  mkdirSync(out);
  writeFileSync(join(out, ".keep"), "keep");
  const refused = spawnSync("bash", [FETCH, "owner", out, "live"], { encoding: "utf8", env: mock.env });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /non-empty/);
  assert.throws(() => readFileSync(mock.log), { code: "ENOENT" });
  rmSync(join(out, ".keep"));
  const result = spawnSync("bash", [FETCH, "owner", out, "live"], { encoding: "utf8", env: mock.env });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!readFileSync(mock.log, "utf8").includes('"graphql"'));
});

test("fetch propagates API errors other than missing workflows", (t) => {
  const mock = mockGh(t);
  const result = spawnSync("bash", [FETCH, "owner", join(mock.dir, "out"), "live"], {
    encoding: "utf8", env: { ...mock.env, GH_FAIL: "1" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTP 403/);
});
