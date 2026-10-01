import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCodexArgs,
  chooseSettings,
  codexReady,
  createReaper,
  descendantTargets,
  formatBudget,
  parseModelsCache,
  parseTurnOutcome,
  rateLimitsProblem,
  readRateLimits,
  recordProblem,
  resolveEffort,
  resolveModel,
  waitableFailure,
} from "./four-eyes.mjs";

const SCRIPT = join(fileURLToPath(new URL(".", import.meta.url)), "four-eyes.mjs");
const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n");

// ---- Codex's event stream ----

test("captures thread id, completion and the final agent message from a successful turn", () => {
  const stdout = lines(
    { type: "thread.started", thread_id: "019eABC" },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "reasoning", text: "thinking..." } },
    { type: "item.completed", item: { type: "agent_message", text: "the answer" } },
    { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 5 } }
  );
  const out = parseTurnOutcome(stdout, "");
  assert.equal(out.threadId, "019eABC");
  assert.equal(out.message, "the answer"); // not the reasoning item
  assert.equal(out.completed, true);
  assert.equal(out.error, "");
});

test("prefers the -o last-message text, falling back to the agent_message event", () => {
  const stdout = lines({ type: "item.completed", item: { type: "agent_message", text: "from stream" } });
  assert.equal(parseTurnOutcome(stdout, "  from -o file \n").message, "from -o file");
  assert.equal(parseTurnOutcome(stdout, "   ").message, "from stream");
});

test("surfaces a quota failure and reports the turn as not completed", () => {
  const stdout = lines(
    { type: "thread.started", thread_id: "019eX" },
    { type: "error", message: "Your workspace is out of credits." },
    { type: "turn.failed", error: { message: "Your workspace is out of credits." } }
  );
  const out = parseTurnOutcome(stdout, "");
  assert.equal(out.error, "Your workspace is out of credits.");
  assert.equal(out.threadId, "019eX"); // thread still captured on failure
  assert.equal(out.completed, false);
});

test("only the last turn counts: a later failure undoes an earlier completion, and vice versa", () => {
  const completedThenFailed = lines(
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text: "first" } },
    { type: "turn.completed" },
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "boom" } }
  );
  assert.deepEqual((({ completed, message, error }) => ({ completed, message, error }))(parseTurnOutcome(completedThenFailed)), {
    completed: false,
    message: "",
    error: "boom",
  });
  const failedThenCompleted = lines(
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "transient" } },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text: "recovered" } },
    { type: "turn.completed" }
  );
  assert.deepEqual((({ completed, message, error }) => ({ completed, message, error }))(parseTurnOutcome(failedThenCompleted)), {
    completed: true,
    message: "recovered",
    error: "",
  });
});

test("takes the first thread id and the last message; ignores non-JSON noise", () => {
  const stdout = [
    "Reading additional input from stdin...",
    lines(
      { type: "thread.started", thread_id: "first" },
      { type: "thread.started", thread_id: "second" },
      { type: "item.completed", item: { type: "agent_message", text: "older" } },
      { type: "turn.completed", usage: { input_tokens: 1 } },
      { type: "item.completed", item: { type: "agent_message", text: "newest" } },
      { type: "turn.completed", usage: { input_tokens: 2 } }
    ),
    "garbage{",
  ].join("\n");
  const out = parseTurnOutcome(stdout, "");
  assert.equal(out.threadId, "first");
  assert.equal(out.message, "newest");
});

// ---- model and effort ----

test("a new label runs on Sol at high; Astra defaults to medium and Luna to its highest effort", () => {
  assert.deepEqual(chooseSettings(null, {}), { model: "sol", effort: "high" });
  assert.deepEqual(chooseSettings(null, { model: "astra" }), { model: "astra", effort: "medium" });
  assert.deepEqual(chooseSettings(null, { model: "luna" }), { model: "luna", effort: "highest" });
});

test("a concrete model of a known family gets that family's default effort; others get none", () => {
  assert.deepEqual(chooseSettings(null, { model: "gpt-6-luna" }), { model: "gpt-6-luna", effort: "highest" });
  assert.deepEqual(chooseSettings(null, { model: "gpt-6-astra" }), { model: "gpt-6-astra", effort: "medium" });
  assert.deepEqual(chooseSettings(null, { model: "gpt-5.6-terra" }), { model: "gpt-5.6-terra", effort: null });
  assert.deepEqual(chooseSettings(null, { model: "gpt-5.5" }), { model: "gpt-5.5", effort: null });
});

test("a label runs on its own model and effort unless this call overrides them", () => {
  const record = { threadId: "t", model: "sol", effort: "xhigh" };
  assert.deepEqual(chooseSettings(record, {}), { model: "sol", effort: "xhigh" });
  assert.deepEqual(chooseSettings(record, { effort: "low" }), { model: "sol", effort: "low" });
  // Switching model for one call takes that family's default, not the label's effort.
  assert.deepEqual(chooseSettings(record, { model: "astra" }), { model: "astra", effort: "medium" });
  assert.deepEqual(chooseSettings(record, { model: "astra", effort: "high" }), { model: "astra", effort: "high" });
  assert.deepEqual(chooseSettings({ threadId: "t", model: "astra" }, {}), { model: "astra", effort: "medium" });
});

const LEVELS = ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort }));
const modelsOf = (...models) => () =>
  models.map(([slug, visibility = "list", levels = LEVELS]) => ({ slug, visibility, supported_reasoning_levels: levels }));

test("a family resolves to its newest listed version, ignoring hidden models and other families", () => {
  const models = modelsOf(["gpt-5.6-sol"], ["gpt-6-sol"], ["gpt-6-astra"], ["gpt-7-sol", "hide"], ["gpt-6-luna"], ["gpt-5.6-luna"]);
  assert.equal(resolveModel("sol", models).slug, "gpt-6-sol");
  assert.equal(resolveModel("astra", models).slug, "gpt-6-astra");
  assert.equal(resolveModel("luna", models).slug, "gpt-6-luna");
});

test("versions compare by integer components", () => {
  assert.equal(resolveModel("sol", modelsOf(["gpt-6.9-sol"], ["gpt-6.10-sol"])).slug, "gpt-6.10-sol");
  assert.equal(resolveModel("sol", modelsOf(["gpt-6-sol"], ["gpt-6.1-sol"])).slug, "gpt-6.1-sol");
  assert.equal(resolveModel("sol", modelsOf(["gpt-7-sol"], ["gpt-6.5-sol"])).slug, "gpt-7-sol");
});

test("a concrete model passes through, with its efforts when the cache lists it", () => {
  assert.deepEqual(resolveModel("gpt-5.5", modelsOf(["gpt-5.5", "list", [{ effort: "high" }]])), { slug: "gpt-5.5", efforts: ["high"] });
  const unreadable = () => {
    throw new Error("no cache");
  };
  assert.deepEqual(resolveModel("gpt-5.5", unreadable), { slug: "gpt-5.5", efforts: null });
});

test("a family with no listed model, or an invalid cache, fails instead of downgrading", () => {
  assert.throws(() => resolveModel("astra", modelsOf(["gpt-6-sol"])), /no listed gpt-<version>-astra/);
  assert.throws(() => parseModelsCache("not json"), /invalid Codex model cache/);
  assert.throws(() => parseModelsCache("{}"), /no "models" array/);
});

test("efforts are checked against what the resolved model supports", () => {
  const luna = ["low", "medium", "high", "xhigh", "max"];
  assert.equal(resolveEffort("highest", "gpt-6-luna", luna), "max");
  assert.equal(resolveEffort("highest", "gpt-6.1-sol", ["ultra", "low", "max"]), "ultra");
  assert.equal(resolveEffort("high", "gpt-6-luna", luna), "high");
  assert.throws(() => resolveEffort("ultra", "gpt-6-luna", luna), /gpt-6-luna does not support effort "ultra"/);
  assert.throws(() => resolveEffort("highest", "gpt-x", null), /"highest" can't be resolved/);
  assert.equal(resolveEffort("max", "gpt-x", null), "max"); // unknown model: any known effort name
  assert.throws(() => resolveEffort("turbo", "gpt-x", null), /does not support effort "turbo"/);
  assert.equal(resolveEffort(null, "gpt-x", null), null);
});

test("a new thread passes --sandbox; a resume passes it as a config override", () => {
  const common = { sandbox: "read-only", model: "gpt-6-sol", effort: "high", lastMsgFile: "/tmp/last.txt" };
  const tail = ["--model", "gpt-6-sol", "-c", 'model_reasoning_effort="high"', "-"];
  assert.deepEqual(buildCodexArgs(common), ["exec", "--json", "--skip-git-repo-check", "-o", "/tmp/last.txt", "--sandbox", "read-only", ...tail]);
  assert.deepEqual(buildCodexArgs({ ...common, threadId: "019eX" }), [
    "exec", "resume", "019eX", "--json", "--skip-git-repo-check", "-o", "/tmp/last.txt", "-c", 'sandbox_mode="read-only"', ...tail,
  ]);
  const noEffort = buildCodexArgs({ ...common, effort: null });
  assert.equal(noEffort.some((a) => a.startsWith("model_reasoning_effort")), false);
});

test("a record needs a thread id and a model, and well-typed optional fields", () => {
  assert.equal(recordProblem({ threadId: "t", model: "sol", effort: null }), null); // legacy fields absent
  assert.equal(recordProblem({ threadId: "t", model: "sol", rounds: 2, cwd: "/w", lastAt: "x", lastStatus: "failed" }), null);
  assert.equal(recordProblem({ model: "sol" }), "no threadId");
  assert.equal(recordProblem({ threadId: "t" }), "no model");
  assert.equal(recordProblem({ threadId: "t", model: "sol", effort: 3 }), "effort is not a string");
  assert.equal(recordProblem({ threadId: "t", model: "sol", rounds: "2" }), "rounds is not a non-negative integer");
  assert.equal(recordProblem({ threadId: "t", model: "sol", rounds: -1 }), "rounds is not a non-negative integer");
  assert.equal(recordProblem({ threadId: "t", model: "sol", cwd: [] }), "cwd is not a string");
  assert.equal(recordProblem({ threadId: "t", model: "sol", lastStatus: 17 }), 'unknown lastStatus "17"');
  assert.equal(recordProblem([]), "not a JSON object");
});

test("descendants in their own process group are signalled as a group, the rest one by one", () => {
  const ps = [
    "  100     1   100", // the wrapper (own group 100)
    "  200   100   100", // codex, in the wrapper's group
    "  300   200   300", // a command codex started in a new group
    "  301   300   300", //   its child
    "  400   200   100", // an helper sharing the wrapper's group
    "  500     1   500", // unrelated
    "garbage",
  ].join("\n");
  assert.deepEqual(descendantTargets(200, ps, 100).sort((a, b) => a - b), [-300, 400]);
  assert.deepEqual(descendantTargets(999, ps, 100), []);
});

// A fake OS for the reaper: `alive` is the set of live targets; every signal is recorded.
function fakeSignals(alive) {
  const sent = [];
  const signal = (target, sig) => {
    if (sig !== 0) sent.push([target, sig]);
    if (sig === "SIGKILL") alive.delete(target);
    return alive.has(target);
  };
  return { sent, signal };
}

test("the reaper SIGKILLs what outlives its grace period, then forgets it", async () => {
  const alive = new Set([300]);
  const { sent, signal } = fakeSignals(alive);
  createReaper(signal, 20).track([300]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(sent, [[300, "SIGKILL"]]);
});

test("a pid reused after its grace period is never killed on exit", async () => {
  const alive = new Set();
  const { sent, signal } = fakeSignals(alive);
  const reaper = createReaper(signal, 20);
  reaper.track([300]); // stopped politely: already gone
  await new Promise((resolve) => setTimeout(resolve, 60));
  alive.add(300); // the OS reuses the pid for an unrelated process
  reaper.reap();
  assert.deepEqual(sent, []);
});

test("on exit, the reaper waits for the grace period and SIGKILLs what is still running", () => {
  const alive = new Set([-300, 400]);
  const { sent, signal } = fakeSignals(alive);
  const reaper = createReaper(signal, 100);
  reaper.track([-300, 400]);
  alive.delete(400); // this one stops in time
  const startedAt = Date.now();
  reaper.reap();
  assert.ok(Date.now() - startedAt >= 90, "waited for the grace period");
  assert.deepEqual(sent, [[-300, "SIGKILL"]]);
});

// ---- limits, budget and waiting ----

const READY = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 2_000_000_000 },
    secondary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: 4_000_000_000 },
    credits: { hasCredits: false, unlimited: false, balance: null },
    planType: "team",
    rateLimitReachedType: null,
  },
  rateLimitResetCredits: { availableCount: 2, credits: [] },
};
const blocked = (reachedType, windows = {}) => ({
  ...READY,
  ordinaryUsageAllowed: false,
  rateLimits: { ...READY.rateLimits, ...windows, rateLimitReachedType: reachedType },
});
const BLOCKED_CREDITS = blocked("workspace_member_credits_depleted");
const BLOCKED_WEEKLY = blocked("rate_limit_reached", { secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 4_000_000_000 } });

test("a limits answer needs the readiness flag and well-formed windows", () => {
  assert.equal(rateLimitsProblem(READY), null);
  assert.equal(rateLimitsProblem(null), "no result");
  assert.equal(rateLimitsProblem({ rateLimits: {} }), "no ordinaryUsageAllowed flag");
  assert.equal(rateLimitsProblem({ ordinaryUsageAllowed: true }), "no rateLimits");
  assert.equal(rateLimitsProblem({ ordinaryUsageAllowed: true, rateLimits: {} }), "no rateLimitReachedType");
  assert.equal(rateLimitsProblem({ ordinaryUsageAllowed: true, rateLimits: { rateLimitReachedType: 3 } }), "malformed rateLimitReachedType");
  const withWindow = (primary) => ({ ordinaryUsageAllowed: true, rateLimits: { rateLimitReachedType: null, primary } });
  assert.equal(rateLimitsProblem(withWindow({ usedPercent: "9" })), "malformed primary window");
});

test("Codex is ready only when ordinary usage is allowed and no limit is reached", () => {
  assert.equal(codexReady(READY), true);
  assert.equal(codexReady(BLOCKED_CREDITS), false);
  assert.equal(codexReady({ ...READY, rateLimits: { ...READY.rateLimits, rateLimitReachedType: "rate_limit_reached" } }), false);
});

test("the budget shows readiness, each window, credits and limit-reset credits", () => {
  const out = formatBudget(READY);
  assert.match(out, /plan: team\); calls allowed now: yes/);
  assert.match(out, /5-hour window: 9% used, resets /);
  assert.match(out, /7-day window: 96% used, resets /);
  assert.match(out, /credits: none/);
  assert.match(out, /limit-reset credits available: 2 \(this wrapper never uses them\)/);
  assert.match(formatBudget(BLOCKED_CREDITS), /calls allowed now: no \(workspace_member_credits_depleted\)/);
});

test("only usage limits and missing credits are waitable", () => {
  assert.equal(waitableFailure("You've hit your usage limit. Try again at 2:54 AM."), "limit");
  assert.equal(waitableFailure("Your workspace is out of credits."), "credits");
  assert.equal(waitableFailure("401 Unauthorized"), null);
  assert.equal(waitableFailure(""), null);
});

// ---- the CLI, against a fake codex ----

// `codex exec` follows plan.json (one scenario per call); `codex app-server` answers
// account/rateLimits/read from limits.json (one entry per poll, the last repeats).
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const dir = process.env.FAKE_CODEX_DIR;
const args = process.argv.slice(2);
const readJson = (name) => (fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) : []);
const count = (name) => {
  const file = path.join(dir, name);
  const n = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) : 0;
  fs.writeFileSync(file, String(n + 1));
  return n;
};
const out = (e) => process.stdout.write(JSON.stringify(e) + "\\n");

if (args[0] === "app-server") {
  const n = count("polls");
  const plan = readJson("limits.json");
  const scenario = plan.length ? plan[Math.min(n, plan.length - 1)] : "error";
  fs.writeFileSync(path.join(dir, "app-server.pid"), String(process.pid));
  // A lingering server answers, then takes a while to exit when asked to stop.
  const linger = scenario && scenario.__linger;
  if (linger) {
    delete scenario.__linger;
    process.on("SIGTERM", () => setTimeout(() => process.exit(0), 800));
  }
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split("\\n");
    buf = lines.pop();
    for (const line of lines) {
      const m = JSON.parse(line);
      if (m.id === 1) {
        if (scenario === "crash") process.exit(1);
        if (scenario !== "hang") out({ id: 1, result: {} });
      } else if (m.id === 2) {
        if (m.method !== "account/rateLimits/read") process.exit(3);
        if (scenario === "error") out({ id: 2, error: { message: "nope" } });
        else if (scenario === "malformed") out({ id: 2, result: { rateLimits: {} } });
        else out({ id: 2, result: scenario });
        fs.writeFileSync(path.join(dir, "answered"), "");
      }
    }
  });
  return;
}

const prompt = fs.readFileSync(0, "utf8");
const n = count("counter");
if ((readJson("plan.json")[n] || "ok") === "orphans") {
  // Like codex's commands: each in its own process group; one of them ignores SIGTERM.
  const { spawn } = require("child_process");
  const start = (code) => spawn(process.execPath, ["-e", code], { detached: true, stdio: "ignore" });
  const polite = start("setInterval(() => {}, 1000)");
  const stubborn = start("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
  fs.writeFileSync(path.join(dir, "orphans.json"), JSON.stringify([polite.pid, stubborn.pid]));
}
const scenario = readJson("plan.json")[n] || "ok";
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ args, prompt, cwd: process.cwd(), at: Date.now() }) + "\\n");
fs.writeFileSync(path.join(dir, "exec.pid"), String(process.pid));
if (scenario === "break-record") {
  // Make the wrapper's record write fail: its temp file path becomes a directory.
  const labels = path.join(process.env.FOUR_EYES_HOME, "labels");
  for (const f of fs.readdirSync(labels)) {
    if (f.endsWith(".lock")) fs.mkdirSync(path.join(labels, f.replace(/\\.lock$/, ".json") + "." + process.ppid + ".tmp"));
  }
}
const threadId = args[1] === "resume" ? args[2] : "thread-" + (n + 1);
out({ type: "thread.started", thread_id: threadId });
out({ type: "turn.started" });
function finish() {
  if (scenario === "limit" || scenario === "credits") {
    const message = scenario === "limit" ? "You've hit your usage limit." : "Your workspace is out of credits.";
    out({ type: "error", message });
    out({ type: "turn.failed", error: { message } });
    process.exit(1);
  }
  if (scenario === "empty") {
    out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 0 } });
    process.exit(0);
  }
  const text = "reply " + (n + 1);
  out({ type: "item.completed", item: { type: "agent_message", text } });
  if (scenario === "nocomplete") process.exit(0);
  fs.writeFileSync(args[args.indexOf("-o") + 1], text);
  out({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } });
  process.exit(0);
}
if (scenario === "slow" || scenario === "break-record" || scenario === "orphans") setTimeout(finish, 3000);
else finish();
`;

const CACHE = {
  models: [
    { slug: "gpt-6.1-sol", visibility: "list", supported_reasoning_levels: LEVELS },
    { slug: "gpt-6-astra", visibility: "list", supported_reasoning_levels: LEVELS },
    { slug: "gpt-6-luna", visibility: "list", supported_reasoning_levels: LEVELS.slice(0, 5) },
  ],
};

// An isolated home: fake codex (the only codex on PATH), model cache and state.
function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "four-eyes-test-")));
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  writeFileSync(join(bin, "codex"), FAKE_CODEX, { mode: 0o755 });
  const codexHome = join(root, "codex");
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, "models_cache.json"), JSON.stringify(CACHE));
  const work = join(root, "work");
  mkdirSync(work);
  const env = {
    PATH: bin,
    HOME: root,
    TMPDIR: root,
    CODEX_HOME: codexHome,
    FOUR_EYES_HOME: join(root, "state"),
    FOUR_EYES_RECHECK_SECONDS: "0.05", // so a real retry without a limits answer comes after 0.25 s
    FAKE_CODEX_DIR: root,
  };
  const plan = (...scenarios) => writeFileSync(join(root, "plan.json"), JSON.stringify(scenarios));
  const limits = (...answers) => writeFileSync(join(root, "limits.json"), JSON.stringify(answers));
  const run = (args, cwd = work) => spawnSync(process.execPath, [SCRIPT, ...args], { env, cwd, encoding: "utf8" });
  const start = (args) => spawn(process.execPath, [SCRIPT, ...args], { env, cwd: work });
  const calls = () =>
    existsSync(join(root, "calls.jsonl")) ? readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const polls = () => (existsSync(join(root, "polls")) ? Number(readFileSync(join(root, "polls"), "utf8")) : 0);
  const pidOf = (name) => Number(readFileSync(join(root, name), "utf8"));
  const recordFile = (label) => join(root, "state", "labels", `${label}.json`);
  const record = (label) => JSON.parse(readFileSync(recordFile(label), "utf8"));
  const lockFile = (label) => join(root, "state", "labels", `${label}.lock`);
  return { root, bin, work, env, plan, limits, run, start, calls, polls, pidOf, record, recordFile, lockFile };
}

const effortOf = (args) => args.find((a) => a.startsWith("model_reasoning_effort"));
const sandboxOf = (args) => (args.includes("--sandbox") ? args[args.indexOf("--sandbox") + 1] : args.find((a) => a.startsWith("sandbox_mode")));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(condition, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("a first call starts a read-only Sol thread at high and records the label", () => {
  const s = sandbox();
  const res = s.run(["task", "--message", "review this"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "reply 1\n");
  assert.match(res.stderr, /action=start thread=thread-1 round=1 model=gpt-6.1-sol effort=high sandbox=read-only/);
  const [call] = s.calls();
  assert.equal(call.prompt, "review this");
  assert.equal(sandboxOf(call.args), "read-only");
  assert.equal(effortOf(call.args), 'model_reasoning_effort="high"');
  assert.deepEqual(
    (({ threadId, model, effort, rounds, lastStatus, cwd }) => ({ threadId, model, effort, rounds, lastStatus, cwd }))(s.record("task")),
    { threadId: "thread-1", model: "sol", effort: null, rounds: 1, lastStatus: "succeeded", cwd: s.work }
  );
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("--model and --write apply to one call only; the label keeps its thread and model", () => {
  const s = sandbox();
  s.run(["task", "--message", "plan"]);
  const astra = s.run(["task", "--model", "astra", "--write", "--message", "look"]);
  assert.equal(astra.status, 0, astra.stderr);
  assert.match(astra.stderr, /model=gpt-6-astra \(this call; label model sol\) effort=medium sandbox=workspace-write/);
  const luna = s.run(["task", "--model", "luna", "--message", "again"]);
  assert.match(luna.stderr, /model=gpt-6-luna .*effort=max sandbox=read-only/);
  s.run(["task", "--message", "back"]);
  const [, second, third, fourth] = s.calls();
  assert.deepEqual(second.args.slice(0, 3), ["exec", "resume", "thread-1"]);
  assert.equal(sandboxOf(second.args), 'sandbox_mode="workspace-write"');
  assert.equal(sandboxOf(third.args), 'sandbox_mode="read-only"');
  assert.deepEqual([fourth.args[fourth.args.indexOf("--model") + 1], effortOf(fourth.args)], ["gpt-6.1-sol", 'model_reasoning_effort="high"']);
  assert.equal(s.record("task").model, "sol");
  assert.equal(s.record("task").rounds, 4);
});

test("a failed first call keeps the thread, so the next call resumes it", () => {
  const s = sandbox();
  s.plan("credits");
  const res = s.run(["task", "--message", "review"]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /out of credits\. \[trace: /);
  assert.deepEqual((({ threadId, rounds, lastStatus }) => ({ threadId, rounds, lastStatus }))(s.record("task")), {
    threadId: "thread-1",
    rounds: 0,
    lastStatus: "failed",
  });
  assert.equal(s.polls(), 0); // without --wait, nothing waits
  assert.equal(s.run(["task", "--message", "retry"]).status, 0);
  assert.deepEqual(s.calls()[1].args.slice(0, 3), ["exec", "resume", "thread-1"]);
});

test("--wait polls Codex's limits and retries the same thread once Codex is ready", () => {
  const s = sandbox();
  s.plan("credits", "ok");
  s.limits(BLOCKED_CREDITS, BLOCKED_CREDITS, READY);
  const res = s.run(["task", "--wait", "--message", "review"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /checking Codex's limits every 0 s \(no model call\)/);
  assert.match(res.stderr, /Codex is available again; attempt 2/);
  assert.equal(s.polls(), 3);
  const [, retry] = s.calls();
  assert.deepEqual(retry.args.slice(0, 3), ["exec", "resume", "thread-1"]);
  assert.match(retry.prompt, /^Note: your previous attempt at this message stopped on a Codex usage limit\..*\n\nreview$/s);
  assert.equal(s.record("task").rounds, 1);
  assert.equal(alive(s.pidOf("app-server.pid")), false);
});

test("--wait keeps polling through a far reset, so a switched account is picked up", () => {
  const s = sandbox();
  s.plan("limit", "ok");
  s.limits(BLOCKED_WEEKLY, BLOCKED_WEEKLY, READY); // the weekly limit resets in years; then the account changes
  const res = s.run(["task", "--wait", "--message", "review"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(s.polls(), 3);
  assert.equal(s.calls().length, 2);
});

test("--wait ignores a far reset of a window that isn't blocking", () => {
  const s = sandbox();
  s.plan("limit", "ok");
  s.limits(READY); // weekly at 96% resetting in decades, but calls are allowed
  assert.equal(s.run(["task", "--wait", "--message", "review"]).status, 0);
  assert.equal(s.calls().length, 2);
});

test("--wait spaces real calls out when Codex says it's ready but the call still fails", () => {
  const s = sandbox();
  s.plan("limit", "limit", "ok");
  s.limits(READY);
  const res = s.run(["task", "--wait", "--message", "review"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /Codex reported itself ready, but the call still failed; next real retry not before/);
  const [, second, third] = s.calls();
  assert.ok(third.at - second.at >= 250, `real retries ${third.at - second.at} ms apart`);
  assert.ok(s.polls() >= 4);
});

test("--wait retries the call itself every 5 polls when the limits can't be read", () => {
  const s = sandbox();
  s.plan("credits", "ok");
  s.limits("error");
  const res = s.run(["task", "--wait", "--message", "review"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /cannot read Codex's limits \(account\/rateLimits\/read failed: nope\); retrying the call itself every 5 polls/);
  const [first, second] = s.calls();
  assert.ok(second.at - first.at >= 250, `real retries ${second.at - first.at} ms apart`);
});

test("--wait treats an answer without readiness data as unreadable, not as ready", () => {
  const s = sandbox();
  s.plan("credits", "ok");
  s.limits({ ordinaryUsageAllowed: true, rateLimits: {} });
  const res = s.run(["task", "--wait", "--message", "review"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /cannot read Codex's limits \(unexpected account\/rateLimits\/read answer: no rateLimitReachedType\)/);
  const [first, second] = s.calls();
  assert.ok(second.at - first.at >= 250, `real retries ${second.at - first.at} ms apart`);
});

test("cancelling while it waits stops the run: no more polls, no more calls", async () => {
  const s = sandbox();
  s.plan("credits", "ok");
  s.limits("hang"); // the poll is in flight when the signal arrives
  const child = s.start(["task", "--wait", "--message", "review"]);
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  await waitFor(() => existsSync(join(s.root, "app-server.pid")));
  child.kill("SIGTERM");
  assert.equal(await done, 130);
  const polls = s.polls();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(s.polls(), polls);
  assert.equal(s.calls().length, 1);
  assert.equal(alive(s.pidOf("app-server.pid")), false);
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("cancelling after a ready answer, before the server exits, still stops the run", async () => {
  const s = sandbox();
  s.plan("credits", "ok");
  s.limits({ ...READY, __linger: true });
  const child = s.start(["task", "--wait", "--message", "review"]);
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  await waitFor(() => existsSync(join(s.root, "answered")));
  child.kill("SIGTERM");
  assert.equal(await done, 130);
  assert.equal(s.calls().length, 1);
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("--wait gives up at its deadline, and never waits on other failures", () => {
  const s = sandbox();
  s.plan("credits");
  s.limits(BLOCKED_CREDITS);
  const late = s.run(["task", "--wait=0.0001", "--message", "review"]);
  assert.notEqual(late.status, 0);
  assert.match(late.stderr, /gave up waiting at the --wait deadline/);
  assert.equal(s.calls().length, 1);

  const t = sandbox();
  t.plan("nocomplete");
  const res = t.run(["task", "--wait", "--message", "review"]);
  assert.match(res.stderr, /codex finished without completing a turn/);
  assert.equal(t.calls().length, 1);
  assert.equal(t.polls(), 0);
});

test("an empty reply is a failure, not a successful round", () => {
  const s = sandbox();
  s.plan("empty");
  const res = s.run(["task", "--message", "review"]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /empty reply/);
  assert.equal(s.record("task").rounds, 0);
});

test("a label runs one call at a time; --reset waits its turn too", async () => {
  const s = sandbox();
  s.plan("slow");
  const first = s.start(["task", "--message", "slow review"]);
  const done = new Promise((resolve) => first.on("close", resolve));
  await waitFor(() => existsSync(s.recordFile("task")));
  const busy = s.run(["task", "--message", "second"]);
  assert.notEqual(busy.status, 0);
  assert.match(busy.stderr, /label task is busy: pid \d+ is running a call on it/);
  assert.match(s.run(["--reset", "task"]).stderr, /is busy/);
  assert.equal(await done, 0);
  assert.equal(s.calls().length, 1);
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("a stale or malformed lock is reported, not taken over", () => {
  const s = sandbox();
  s.run(["task", "--message", "first"]);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(s.lockFile("task"), `${dead}\n`);
  assert.match(s.run(["task", "--message", "x"]).stderr, new RegExp(`stale lock .*pid ${dead} is no longer running`));
  writeFileSync(s.lockFile("task"), "garbage");
  assert.match(s.run(["task", "--message", "x"]).stderr, /malformed lock file/);
  assert.equal(s.calls().length, 1);
});

test("a stopped call kills codex, records the failure and releases the lock", async () => {
  const s = sandbox();
  s.plan("slow");
  const child = s.start(["task", "--message", "slow review"]);
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  await waitFor(() => existsSync(s.recordFile("task")));
  child.kill("SIGTERM");
  assert.notEqual(await done, 0);
  assert.equal(s.record("task").lastStatus, "failed");
  assert.equal(alive(s.pidOf("exec.pid")), false);
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("a stopped call also stops the commands codex started in their own process groups", async () => {
  const s = sandbox();
  s.plan("orphans");
  const child = s.start(["task", "--message", "review"]);
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  const orphansFile = join(s.root, "orphans.json");
  await waitFor(() => existsSync(orphansFile) && existsSync(s.recordFile("task")));
  await new Promise((resolve) => setTimeout(resolve, 200)); // let the stubborn one install its handler
  const [polite, stubborn] = JSON.parse(readFileSync(orphansFile, "utf8"));
  child.kill("SIGTERM");
  assert.notEqual(await done, 0);
  assert.equal(alive(polite), false);
  assert.equal(alive(stubborn), false); // SIGKILLed after the grace period, before the wrapper exited
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("a failure to record the call stops codex before the lock is released", () => {
  const s = sandbox();
  s.plan("break-record");
  const startedAt = Date.now();
  const res = s.run(["task", "--message", "review"]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /the wrapper failed while recording the call, so codex was stopped/);
  assert.ok(Date.now() - startedAt < 2500, "codex was not left running its 3 s turn");
  assert.equal(alive(s.pidOf("exec.pid")), false);
  assert.equal(existsSync(s.lockFile("task")), false);
});

test("an invalid record fails the call instead of starting a new thread", () => {
  const s = sandbox();
  mkdirSync(join(s.root, "state", "labels"), { recursive: true });
  writeFileSync(s.recordFile("task"), JSON.stringify({ threadId: "t", model: "sol", rounds: "2" }));
  const res = s.run(["task", "--message", "x"]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /invalid record .*task\.json: rounds is not a non-negative integer/);
  assert.equal(s.calls().length, 0);
  assert.match(s.run(["--reset", "task"]).stdout, /reset: task/);
});

test("calling a label from another directory says so, and Codex runs there", () => {
  const s = sandbox();
  s.run(["task", "--message", "first"]);
  const other = join(s.root, "other");
  mkdirSync(other);
  const res = s.run(["task", "--message", "second"], other);
  assert.match(res.stderr, /label task last ran in .*work; this call runs in .*other/);
  assert.equal(s.calls()[1].cwd, other);
  assert.equal(s.record("task").cwd, other);
});

test("--budget reads Codex's limits without a model call, and fails clearly on a bad answer", () => {
  const s = sandbox();
  s.limits(READY);
  const res = s.run(["--budget"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /calls allowed now: yes/);
  assert.match(res.stdout, /7-day window: 96% used/);
  assert.equal(s.calls().length, 0);

  const t = sandbox();
  t.limits("malformed");
  assert.match(t.run(["--budget"]).stderr, /unexpected account\/rateLimits\/read answer: no ordinaryUsageAllowed flag/);
});

test("reading the limits times out on a silent server and fails on a crashed one, reaping both", async () => {
  const s = sandbox();
  const saved = { PATH: process.env.PATH, FAKE_CODEX_DIR: process.env.FAKE_CODEX_DIR };
  Object.assign(process.env, { PATH: s.bin, FAKE_CODEX_DIR: s.root });
  try {
    s.limits("hang");
    await assert.rejects(readRateLimits(300), /did not answer within 0.3 s/);
    assert.equal(alive(s.pidOf("app-server.pid")), false);
    s.limits("crash");
    await assert.rejects(readRateLimits(5000), /exited without answering/);
    s.limits(READY);
    assert.deepEqual(await readRateLimits(5000), READY);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("bad arguments fail clearly", () => {
  const s = sandbox();
  assert.match(s.run(["task", "--sandbox", "workspace-write", "--message", "x"]).stderr, /--sandbox was replaced by --write/);
  assert.match(s.run(["task", "--message", "x", "--", "y"]).stderr, /give the prompt one way/);
  assert.match(s.run(["task", "--model", "astra", "--effort", "turbo", "--message", "x"]).stderr, /gpt-6-astra does not support effort "turbo"/);
  assert.match(s.run(["task", "--wait=0", "--message", "x"]).stderr, /invalid --wait hours/);
  assert.match(s.run(["../x", "--message", "x"]).stderr, /invalid label/);
  const badPoll = spawnSync(process.execPath, [SCRIPT, "task", "--wait", "--message", "x"], {
    env: { ...s.env, FOUR_EYES_RECHECK_SECONDS: "soon" },
    cwd: s.work,
    encoding: "utf8",
  });
  assert.match(badPoll.stderr, /invalid FOUR_EYES_RECHECK_SECONDS: soon/);
  assert.equal(s.calls().length, 0);
});
