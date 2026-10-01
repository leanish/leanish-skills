#!/usr/bin/env node
// four-eyes.mjs — one persistent Codex thread per label.
//
// The first call on a <label> starts a `codex exec` thread and records its id under
// that label; every later call resumes it, so Codex keeps the whole conversation.
// Different labels are different threads and may run in parallel; a label runs one
// call at a time (enforced with a lock file). Run with --help for usage.
//
// stdout = Codex's final message. stderr = one status line (or the error).

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const STATE_DIR = process.env.FOUR_EYES_HOME || join(homedir(), ".claude", "four-eyes");
const LABELS_DIR = join(STATE_DIR, "labels");
const LOG_DIR = join(STATE_DIR, "logs");
const LOG_KEEP = 100; // most-recent logs to retain; older ones are pruned
const MODELS_CACHE_FILE = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "models_cache.json");

// Labels become filenames, so keep them to a safe slug with an alphanumeric start
// (rejects ".", "..", "../x") and a bounded length.
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_LABEL_LEN = 64;
const STATUSES = new Set(["started", "failed", "succeeded"]);

// The model families the user can name, with their default effort. A family resolves,
// on every call, to its newest listed `gpt-<version>-<family>` in Codex's model cache.
const HIGHEST = "highest"; // the highest effort the resolved model supports
const FAMILY_EFFORT = { sol: "high", astra: "medium", luna: HIGHEST };
const FAMILY_SLUG_RE = /^gpt-\d+(?:\.\d+)*-([a-z]+)$/;
const DEFAULT_MODEL = "sol";
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]; // lowest first

const WAIT_DEFAULT_HOURS = 48;
const WAIT_MAX_HOURS = 168;
const POLL_DEFAULT_SECONDS = 60; // --wait reads Codex's limits this often (no model call)
const REAL_RETRY_POLLS = 5; // real calls without a usable readiness answer, or after a false "ready": every 5 polls (5 min)
const API_TIMEOUT_MS = 20_000;
const KILL_GRACE_MS = 5_000;
const STDERR_KEEP = 64 * 1024;
const RETRY_NOTE =
  "Note: your previous attempt at this message stopped on a Codex usage limit. Check what you " +
  "already did (files changed, commands run) before continuing, and don't redo it.\n\n";

let heldLock = null; // the lock file this process owns
let currentChild = null; // the running codex process, if any
let cancelledBy = null; // the signal that cancelled this run, if any

function die(message, code = 1) {
  process.stderr.write(`[four-eyes] error: ${message}\n`);
  process.exit(code);
}

// A signal cancels the whole run, whatever it interrupted (a call, a poll, a sleep).
function exitIfCancelled() {
  if (cancelledBy) die(`interrupted by ${cancelledBy}`, 130);
}

function note(message) {
  process.stderr.write(`[four-eyes] ${message}\n`);
}

function requireValidLabel(label) {
  if (typeof label !== "string" || label.length > MAX_LABEL_LEN || !LABEL_RE.test(label)) {
    die(`invalid label "${label}" — use letters, digits, . _ - (start alphanumeric, max ${MAX_LABEL_LEN} chars)`);
  }
}

const recordPath = (label) => join(LABELS_DIR, `${label}.json`);
const lockPath = (label) => join(LABELS_DIR, `${label}.lock`);

// Records hold thread pointers and logs hold raw agent output: keep both owner-only.
// mkdir's mode applies on creation only, so chmod existing dirs too.
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort */
  }
}

function writeFileAtomic(path, contents) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, path);
}

// Why a parsed record can't be used, or null when it can. Fields older records lack
// are fine; fields that are present must have the right type.
export function recordProblem(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "not a JSON object";
  if (typeof record.threadId !== "string" || record.threadId === "") return "no threadId";
  if (typeof record.model !== "string" || record.model === "") return "no model";
  if (record.effort != null && typeof record.effort !== "string") return "effort is not a string";
  if (record.rounds != null && !(Number.isInteger(record.rounds) && record.rounds >= 0)) return "rounds is not a non-negative integer";
  for (const field of ["cwd", "createdAt", "lastAt", "lastSandbox"]) {
    if (record[field] != null && typeof record[field] !== "string") return `${field} is not a string`;
  }
  if (record.lastStatus != null && !STATUSES.has(record.lastStatus)) return `unknown lastStatus "${record.lastStatus}"`;
  return null;
}

function readRecord(label) {
  const path = recordPath(label);
  if (!existsSync(path)) return { record: null, problem: null };
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { record: null, problem: `unreadable (${err.message})` };
  }
  const problem = recordProblem(record);
  return problem ? { record: null, problem } : { record, problem: null };
}

// An invalid record fails the call: starting a fresh thread would silently lose the old one.
function loadRecord(label) {
  const { record, problem } = readRecord(label);
  if (problem) die(`invalid record ${recordPath(label)}: ${problem}; fix it, or --reset the label`);
  return record;
}

function saveRecord(label, record) {
  ensureDir(LABELS_DIR);
  writeFileAtomic(recordPath(label), JSON.stringify(record, null, 2));
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, owned by someone else
  }
}

function lockHeldMessage(label, path) {
  let pid;
  try {
    pid = Number(readFileSync(path, "utf8").trim());
  } catch (err) {
    return `label ${label} is locked (${path} is unreadable: ${err.message})`;
  }
  if (!Number.isInteger(pid) || pid <= 0) return `label ${label} is locked by a malformed lock file ${path}`;
  if (pidAlive(pid)) return `label ${label} is busy: pid ${pid} is running a call on it`;
  return `stale lock ${path}: pid ${pid} is no longer running; delete the file once no call on ${label} is running`;
}

// One call per label. A lock left by a dead process is reported, not taken over:
// two callers could otherwise both take it and run on the same thread.
function acquireLock(label) {
  ensureDir(LABELS_DIR);
  const path = lockPath(label);
  try {
    writeFileSync(path, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  } catch (err) {
    die(err.code === "EEXIST" ? lockHeldMessage(label, path) : `cannot create lock ${path}: ${err.message}`);
  }
  heldLock = path;
}

// Removes the lock only if this process still owns it.
function releaseLock() {
  if (!heldLock) return;
  try {
    if (Number(readFileSync(heldLock, "utf8").trim()) === process.pid) rmSync(heldLock, { force: true });
  } catch {
    /* already gone */
  }
  heldLock = null;
}

function takeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value == null) die(`${flag} needs a value`);
  return value;
}

function parseWaitHours(text) {
  const hours = text == null ? WAIT_DEFAULT_HOURS : Number(text);
  if (!Number.isFinite(hours) || hours <= 0 || hours > WAIT_MAX_HOURS) {
    die(`invalid --wait hours: ${text} (more than 0, at most ${WAIT_MAX_HOURS})`);
  }
  return hours;
}

function parseArgs(argv) {
  const opts = { label: null, promptParts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      opts.promptParts.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--wait=")) {
      opts.waitHours = parseWaitHours(arg.slice("--wait=".length));
      continue;
    }
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--list":
        opts.list = true;
        break;
      case "--budget":
        opts.budget = true;
        break;
      case "--show":
      case "--reset":
        opts[arg.slice(2)] = takeValue(argv, i++, arg);
        break;
      case "--prompt-file":
        opts.promptFile = takeValue(argv, i++, arg);
        break;
      case "--message":
        opts.message = takeValue(argv, i++, arg);
        break;
      case "--stdin":
        opts.stdin = true;
        break;
      case "--model":
        opts.model = takeValue(argv, i++, arg);
        break;
      case "--effort":
        opts.effort = takeValue(argv, i++, arg);
        break;
      case "--write":
        opts.write = true;
        break;
      case "--wait":
        opts.waitHours = parseWaitHours(null);
        break;
      case "--trace":
        opts.trace = true;
        break;
      case "--sandbox":
        die("--sandbox was replaced by --write: workspace-write for that call; every other call is read-only");
        break;
      default:
        if (arg.startsWith("-")) die(`unknown option: ${arg}`);
        if (opts.label == null) opts.label = arg;
        else opts.promptParts.push(arg);
    }
  }
  return opts;
}

function resolvePrompt(opts) {
  const given = [opts.promptFile != null, opts.message != null, opts.stdin === true, opts.promptParts.length > 0];
  if (given.filter(Boolean).length > 1) die("give the prompt one way: --prompt-file, --message, --stdin or -- <words>");
  if (opts.promptFile != null) {
    if (!existsSync(opts.promptFile)) die(`prompt file not found: ${opts.promptFile}`);
    return readFileSync(opts.promptFile, "utf8");
  }
  if (opts.message != null) return opts.message;
  if (opts.stdin) return readFileSync(0, "utf8");
  return opts.promptParts.join(" ");
}

// The default effort for a family, or for a concrete model of a family
// (`gpt-6-luna` gets Luna's); null for anything else.
function familyEffort(model) {
  const family = Object.hasOwn(FAMILY_EFFORT, model) ? model : FAMILY_SLUG_RE.exec(model)?.[1];
  return family != null && Object.hasOwn(FAMILY_EFFORT, family) ? FAMILY_EFFORT[family] : null;
}

// Model and effort names for one call. --model and --effort apply to this call
// only; without them the call runs on the label's model and effort. When a call
// switches model, or nothing set an effort, the family's default effort applies.
export function chooseSettings(record, opts) {
  const model = opts.model ?? record?.model ?? DEFAULT_MODEL;
  const labelEffort = model === record?.model ? record.effort : null;
  return { model, effort: opts.effort ?? labelEffort ?? familyEffort(model) };
}

// Parses Codex's model cache text; throws when it isn't JSON with a `models` array.
export function parseModelsCache(text) {
  let cache;
  try {
    cache = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid Codex model cache (${MODELS_CACHE_FILE}): ${err.message}`);
  }
  if (!Array.isArray(cache?.models)) {
    throw new Error(`invalid Codex model cache (${MODELS_CACHE_FILE}): no "models" array`);
  }
  return cache.models;
}

function readModels() {
  let text;
  try {
    text = readFileSync(MODELS_CACHE_FILE, "utf8");
  } catch (err) {
    throw new Error(`cannot read Codex model cache ${MODELS_CACHE_FILE}: ${err.message}`);
  }
  return parseModelsCache(text);
}

function effortsOf(entry) {
  const efforts = (entry?.supported_reasoning_levels ?? []).map((level) => level?.effort).filter((e) => typeof e === "string");
  return efforts.length > 0 ? efforts : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The codex model for a model name, and the efforts it supports (null when unknown).
// A family becomes its newest listed `gpt-<version>-<family>` (versions compare by
// integer parts, so 6.10 > 6.9), failing rather than falling back to an older one.
// Any other name is a concrete model, passed as is.
export function resolveModel(name, loadModels) {
  if (!Object.hasOwn(FAMILY_EFFORT, name)) {
    let models;
    try {
      models = loadModels();
    } catch {
      return { slug: name, efforts: null }; // codex itself validates a concrete model
    }
    return { slug: name, efforts: effortsOf(models.find((m) => m?.slug === name)) };
  }
  const pattern = new RegExp(`^gpt-(\\d+(?:\\.\\d+)*)-${name}$`);
  const candidates = loadModels().flatMap((entry) => {
    const match = entry?.visibility === "list" && pattern.exec(entry.slug ?? "");
    return match ? [{ entry, version: match[1].split(".").map(Number) }] : [];
  });
  if (candidates.length === 0) throw new Error(`no listed gpt-<version>-${name} model in ${MODELS_CACHE_FILE}`);
  const newest = candidates.reduce((best, c) => (compareVersions(c.version, best.version) > 0 ? c : best));
  return { slug: newest.entry.slug, efforts: effortsOf(newest.entry) };
}

// The effort codex gets: "highest" becomes the model's highest supported effort; any
// other effort must be one the model supports (or a known effort name, when the
// cache doesn't list the model). Null leaves the effort to codex's config.
export function resolveEffort(effort, slug, efforts) {
  if (effort == null) return null;
  if (effort === HIGHEST) {
    const known = (efforts ?? []).filter((e) => EFFORTS.includes(e));
    if (known.length === 0) throw new Error(`the efforts of ${slug} are unknown, so "highest" can't be resolved; pass --effort`);
    return known.reduce((a, b) => (EFFORTS.indexOf(b) > EFFORTS.indexOf(a) ? b : a));
  }
  const allowed = efforts ?? EFFORTS;
  if (!allowed.includes(effort)) {
    throw new Error(`${slug} does not support effort "${effort}" (supports: ${allowed.join(", ")}, or highest)`);
  }
  return effort;
}

// The codex argv for one call; a threadId means resume. `exec resume` has no
// --sandbox flag, so a resume passes it as a config override (otherwise it would run
// on config.toml's sandbox_mode). The prompt goes over stdin (`-`): no ARG_MAX limit,
// and it stays out of process listings.
export function buildCodexArgs({ threadId, sandbox, model, effort, lastMsgFile }) {
  const args = ["exec"];
  if (threadId) args.push("resume", threadId);
  args.push("--json", "--skip-git-repo-check", "-o", lastMsgFile);
  args.push(...(threadId ? ["-c", `sandbox_mode="${sandbox}"`] : ["--sandbox", sandbox]));
  if (model) args.push("--model", model);
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  args.push("-");
  return args;
}

function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null; // not a JSON line
  }
}

// Folds Codex's JSONL events, one line at a time, into what a call needs. Only the
// last turn counts: `turn.started` resets its completion, reply and error.
export function createOutcome() {
  let threadId = null;
  let error = "";
  let completed = false;
  let agentMessage = "";
  return {
    add(line) {
      const event = parseEvent(line);
      if (!event) return null;
      if (!threadId && typeof event.thread_id === "string" && event.thread_id) threadId = event.thread_id;
      const type = String(event.type ?? "");
      if (type === "turn.started") {
        completed = false;
        agentMessage = "";
        error = "";
      } else if (type === "turn.completed") {
        completed = true;
      } else if (type === "error" || type === "turn.failed") {
        const msg = event.message ?? event.error?.message;
        if (msg) error = msg;
        if (type === "turn.failed") completed = false;
      } else if (type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        agentMessage = event.item.text;
      }
      return event;
    },
    // `lastMsgText` is the `-o` last-message file, preferred over the agent_message event.
    result(lastMsgText = "") {
      return { threadId, error, completed, message: (lastMsgText || "").trim() || agentMessage.trim() };
    },
  };
}

export function parseTurnOutcome(stdout, lastMsgText = "") {
  const outcome = createOutcome();
  for (const line of stdout.split("\n")) outcome.add(line);
  return outcome.result(lastMsgText);
}

// What to signal besides a process: its descendants, as process groups when they have their own
// (codex runs each command in a new group and leaves them running when it is stopped), or one by
// one when they share ours. Empty when `ps` can't list processes.
export function descendantTargets(rootPid, psOutput, ownPid) {
  const rows = psOutput
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 3 && row.every(Number.isInteger));
  const ownGroup = rows.find(([pid]) => pid === ownPid)?.[2];
  const children = new Map();
  for (const [pid, ppid, pgid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), { pid, pgid }]);
  const targets = new Set();
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const { pid, pgid } = queue.shift();
    if (pid === ownPid) continue;
    targets.add(pgid !== ownGroup && pgid > 1 ? -pgid : pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return [...targets];
}

function signalTarget(target, signal) {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false; // already gone
  }
}

// Tracks what this run asked to stop: whatever is still there when its grace period ends gets
// SIGKILL, and then it is forgotten, so a reused pid or group id is never touched. `reap` does the
// same synchronously for whatever is still in its grace period when the wrapper exits.
export function createReaper(signal = signalTarget, graceMs = KILL_GRACE_MS) {
  const pending = new Set();
  const alive = (target) => signal(target, 0);
  const finish = (entry) => {
    if (!pending.delete(entry)) return;
    for (const target of entry.targets) if (alive(target)) signal(target, "SIGKILL");
  };
  return {
    track(targets) {
      const entry = { targets, killAt: Date.now() + graceMs };
      pending.add(entry);
      setTimeout(() => finish(entry), graceMs).unref();
    },
    reap() {
      const pause = new Int32Array(new SharedArrayBuffer(4));
      for (const entry of [...pending]) {
        while (entry.targets.some(alive) && Date.now() < entry.killAt) Atomics.wait(pause, 0, 0, 50);
        finish(entry);
      }
    },
  };
}

const reaper = createReaper();

// Stops a child and its descendants: the signal now, SIGKILL for whatever is still there after the
// grace period, even if the wrapper is exiting by then.
function stopChild(child, signal = "SIGTERM") {
  if (child.pid == null) return;
  const ps = spawnSync(existsSync("/bin/ps") ? "/bin/ps" : "ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8" });
  const targets = ps.status === 0 ? descendantTargets(child.pid, ps.stdout, process.pid) : [];
  if (child.exitCode == null && child.signalCode == null) targets.push(child.pid);
  for (const target of targets) signalTarget(target, signal);
  reaper.track(targets);
}

// Why an `account/rateLimits/read` result can't be used, or null.
export function rateLimitsProblem(result) {
  if (!result || typeof result !== "object") return "no result";
  if (typeof result.ordinaryUsageAllowed !== "boolean") return "no ordinaryUsageAllowed flag";
  const limits = result.rateLimits;
  if (!limits || typeof limits !== "object") return "no rateLimits";
  // Readiness needs an explicit answer: null (nothing reached) or the reason.
  if (!Object.hasOwn(limits, "rateLimitReachedType")) return "no rateLimitReachedType";
  if (limits.rateLimitReachedType !== null && typeof limits.rateLimitReachedType !== "string") return "malformed rateLimitReachedType";
  for (const key of ["primary", "secondary"]) {
    const w = limits[key];
    if (w != null && (typeof w !== "object" || !Number.isFinite(w.usedPercent))) return `malformed ${key} window`;
  }
  return null;
}

// Codex's current usage limits, read through `codex app-server` (no model call).
// Rejects when the server can't start, errs, answers malformed data or times out;
// settles only once the server process is gone.
export function readRateLimits(timeoutMs = API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    currentChild = child;
    let answer = null;
    let pending = "";
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const done = (result) => {
      if (answer) return;
      answer = result;
      clearTimeout(timer);
      stopChild(child);
    };
    const settle = () => {
      if (currentChild === child) currentChild = null;
      if (answer?.value) resolve(answer.value);
      else reject(new Error(answer?.error ?? "codex app-server exited without answering"));
    };
    const timer = setTimeout(() => done({ error: `codex app-server did not answer within ${timeoutMs / 1000} s` }), timeoutMs);
    child.on("error", (err) => {
      done({ error: `cannot run codex app-server: ${err.message}` });
      if (child.pid == null) settle(); // never started, so no close event
    });
    child.on("close", settle);
    child.stdin.on("error", () => {}); // the server may exit before reading everything
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        const message = parseEvent(line);
        if (message?.id === 1) {
          if (message.error) return done({ error: `codex app-server initialize failed: ${message.error.message ?? "unknown"}` });
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read" });
        } else if (message?.id === 2) {
          if (message.error) return done({ error: `account/rateLimits/read failed: ${message.error.message ?? "unknown"}` });
          const problem = rateLimitsProblem(message.result);
          return done(problem ? { error: `unexpected account/rateLimits/read answer: ${problem}` } : { value: message.result });
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "four-eyes", version: "1" } } });
  });
}

// Whether Codex accepts ordinary calls now.
export function codexReady(limits) {
  return limits.ordinaryUsageAllowed === true && limits.rateLimits.rateLimitReachedType === null;
}

const formatTime = (ms) =>
  new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function windowName(minutes) {
  if (!Number.isFinite(minutes)) return "window";
  return minutes >= 1440 ? `${Math.round(minutes / 1440)}-day window` : `${Math.round(minutes / 60)}-hour window`;
}

export function formatBudget(limits) {
  const { rateLimits } = limits;
  const blocked = rateLimits.rateLimitReachedType ? `no (${rateLimits.rateLimitReachedType})` : "no";
  const lines = [`Codex usage (plan: ${rateLimits.planType ?? "unknown"}); calls allowed now: ${codexReady(limits) ? "yes" : blocked}`];
  for (const key of ["primary", "secondary"]) {
    const w = rateLimits[key];
    if (!w) continue;
    const reset = Number.isFinite(w.resetsAt) ? `, resets ${formatTime(w.resetsAt * 1000)}` : "";
    lines.push(`  ${windowName(w.windowDurationMins)}: ${w.usedPercent}% used${reset}`);
  }
  const credits = rateLimits.credits;
  if (credits && typeof credits === "object") {
    const state = credits.unlimited ? "unlimited" : credits.hasCredits ? `available${credits.balance != null ? ` (${credits.balance})` : ""}` : "none";
    lines.push(`  credits: ${state}`);
  }
  const resetCredits = limits.rateLimitResetCredits?.availableCount;
  if (Number.isInteger(resetCredits)) lines.push(`  limit-reset credits available: ${resetCredits} (this wrapper never uses them)`);
  return `${lines.join("\n")}\n`;
}

// The kind of failure --wait can wait out, or null.
export function waitableFailure(error) {
  if (/usage limit/i.test(error)) return "limit";
  if (/out of credits/i.test(error)) return "credits";
  return null;
}

function pollMs() {
  const text = process.env.FOUR_EYES_RECHECK_SECONDS;
  const seconds = text == null ? POLL_DEFAULT_SECONDS : Number(text);
  if (!Number.isFinite(seconds) || seconds <= 0) die(`invalid FOUR_EYES_RECHECK_SECONDS: ${text}`);
  return seconds * 1000;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// Waits until a real retry makes sense, reading Codex's limits every poll (no model
// call). A retry happens once Codex reports itself ready and any cooldown is over;
// when the limits can't be read, the call itself is retried every REAL_RETRY_POLLS
// polls. A far reset time doesn't end the wait (the account or its credits can
// change before it); only the deadline does.
// `lastRealAttemptAt` is when the failed call ended.
async function waitForCodex({ deadline, poll, lastRealAttemptAt, cooldownUntil, failure, logFile }) {
  const giveUp = (why) => die(`${failure}; ${why} [trace: ${logFile}]`);
  let apiFailureNoted = false;
  for (;;) {
    if (Date.now() > deadline) giveUp(`gave up waiting at the --wait deadline (${formatTime(deadline)})`);
    let limits = null;
    let apiError = null;
    try {
      limits = await readRateLimits();
    } catch (err) {
      apiError = err;
    }
    exitIfCancelled(); // the signal may have arrived during the poll, answered or not
    if (apiError && !apiFailureNoted) {
      note(`cannot read Codex's limits (${apiError.message}); retrying the call itself every ${REAL_RETRY_POLLS} polls`);
      apiFailureNoted = true;
    }
    const now = Date.now();
    if (limits) {
      if (codexReady(limits) && now >= cooldownUntil) return { ready: true };
    } else if (now >= lastRealAttemptAt + REAL_RETRY_POLLS * poll) {
      return { ready: false };
    }
    await sleep(Math.min(poll, deadline - now + 1));
  }
}

// Prune the log dir to the most-recent LOG_KEEP files.
function pruneLogs() {
  let entries;
  try {
    entries = readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return;
  }
  if (entries.length <= LOG_KEEP) return;
  const byAge = entries
    .map((f) => {
      const full = join(LOG_DIR, f);
      try {
        return { full, mtime: statSync(full).mtimeMs };
      } catch {
        return { full, mtime: 0 };
      }
    })
    .sort((a, b) => a.mtime - b.mtime);
  for (const { full } of byAge.slice(0, byAge.length - LOG_KEEP)) rmSync(full, { force: true });
}

// Runs codex, folding its events into an outcome and writing them to the log as they
// arrive; reports the thread id as soon as it appears, so a call that fails or is
// killed later can be resumed. If logging or recording fails, codex is stopped and
// the failure is reported once it has exited. Settles only once codex is gone.
function runCodex(args, prompt, { logFd, trace, onThreadId }) {
  return new Promise((resolve) => {
    const outcome = createOutcome();
    let stderr = "";
    let pending = "";
    let threadSeen = false;
    let wrapperError = null;
    let launchError = null;
    const child = spawn("codex", args, { stdio: ["pipe", "pipe", "pipe"] });
    currentChild = child;
    const handleLine = (line) => {
      const event = outcome.add(line);
      if (!threadSeen && typeof event?.thread_id === "string" && event.thread_id) {
        threadSeen = true;
        onThreadId(event.thread_id);
      }
    };
    const guarded = (work) => {
      if (wrapperError) return;
      try {
        work();
      } catch (err) {
        wrapperError = err;
        stopChild(child);
      }
    };
    const finish = (status, signal) => {
      if (currentChild === child) currentChild = null;
      resolve({ status, signal, stderr, launchError, wrapperError, outcome });
    };
    child.on("error", (err) => {
      launchError ??= err;
      if (child.pid == null) finish(null, null); // never started, so no close event
    });
    child.on("close", (status, signal) => {
      if (pending) guarded(() => handleLine(pending));
      finish(status, signal);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) =>
      guarded(() => {
        writeSync(logFd, chunk);
        if (trace) process.stderr.write(chunk);
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines) handleLine(line);
      })
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
    });
    child.stdin.on("error", () => {}); // codex may exit before reading all of the prompt
    child.stdin.end(prompt);
  });
}

// One attempt at a call. Keeps the record current: "started" before launching (or as
// soon as a new thread exists), then "succeeded" or "failed"; rounds counts successes.
async function attemptCall({ label, record, prompt, call }) {
  const cwd = process.cwd();
  const startedAt = new Date().toISOString();
  let saved = null;
  const save = (fields) => {
    saved = { ...saved, ...fields };
    delete saved.sandbox; // the sandbox is per call now; a stored one is ignored
    saveRecord(label, saved);
  };
  if (record) {
    saved = { ...record };
    save({ cwd, lastAt: startedAt, lastStatus: "started", lastSandbox: call.sandbox });
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "four-eyes-"));
  const lastMsgFile = join(tmpDir, "last.txt");
  ensureDir(LOG_DIR);
  const logFile = join(LOG_DIR, `${label}-${startedAt.replace(/[:.]/g, "-")}.jsonl`);
  const logFd = openSync(logFile, "w", 0o600);
  const args = buildCodexArgs({ threadId: record?.threadId, sandbox: call.sandbox, model: call.slug, effort: call.effort, lastMsgFile });
  const startThread = (threadId) =>
    save({ threadId, model: call.labelModel, effort: call.labelEffort, cwd, createdAt: startedAt, lastAt: startedAt, rounds: 0, lastStatus: "started", lastSandbox: call.sandbox });
  if (call.trace) note(`codex ${args.join(" ")}`);
  let run;
  try {
    run = await runCodex(args, prompt, { logFd, trace: call.trace, onThreadId: record ? () => {} : startThread });
    if (run.stderr) writeSync(logFd, `\n--- codex stderr (last ${STDERR_KEEP} bytes) ---\n${run.stderr}\n`);
  } finally {
    closeSync(logFd);
  }
  const lastMsgText = existsSync(lastMsgFile) ? readFileSync(lastMsgFile, "utf8") : "";
  rmSync(tmpDir, { recursive: true, force: true });
  pruneLogs();
  if (call.trace && run.stderr) process.stderr.write(`--- codex stderr ---\n${run.stderr}`);

  const outcome = run.outcome.result(lastMsgText);
  if (!saved && outcome.threadId && !run.wrapperError) startThread(outcome.threadId);
  const failure = run.wrapperError
    ? `the wrapper failed while recording the call, so codex was stopped: ${run.wrapperError.message}`
    : run.launchError
      ? `failed to launch codex: ${run.launchError.message}`
      : run.signal
        ? `codex was stopped by ${run.signal}`
        : run.status !== 0
          ? outcome.error || `codex exited with status ${run.status}`
          : !outcome.completed
            ? outcome.error || "codex finished without completing a turn"
            : outcome.message === ""
              ? "codex completed the turn with an empty reply"
              : !saved
                ? "could not capture the thread id from codex output"
                : null;
  const endedAt = new Date().toISOString();
  if (failure) {
    if (saved) {
      try {
        save({ lastAt: endedAt, lastStatus: "failed" });
      } catch {
        /* the failure below already says what went wrong */
      }
    }
    const interrupted = Boolean(run.signal || run.launchError || run.wrapperError);
    return { ok: false, failure, error: outcome.error, interrupted, status: run.status || 1, record: saved, logFile, stderr: run.stderr };
  }
  save({ lastAt: endedAt, lastStatus: "succeeded", rounds: (saved.rounds ?? 0) + 1 });
  return { ok: true, record: saved, outcome, logFile, resumed: record != null };
}

async function callCodex(opts) {
  if (!opts.label) die("a <label> is required");
  requireValidLabel(opts.label);
  const prompt = resolvePrompt(opts);
  if (prompt.trim() === "") die("a prompt is required (--prompt-file, --message, --stdin, or -- <words>)");

  acquireLock(opts.label);
  let record = loadRecord(opts.label);
  const { model, effort } = chooseSettings(record, opts);
  let call;
  try {
    const resolved = resolveModel(model, readModels);
    call = {
      slug: resolved.slug,
      effort: resolveEffort(effort, resolved.slug, resolved.efforts),
      sandbox: opts.write ? "workspace-write" : "read-only",
      // A new label keeps the model it was started with, and an effort only if one was given.
      labelModel: model,
      labelEffort: opts.effort ?? null,
      trace: opts.trace === true,
    };
  } catch (err) {
    die(err.message);
  }
  if (record?.cwd && record.cwd !== process.cwd()) {
    note(`label ${opts.label} last ran in ${record.cwd}; this call runs in ${process.cwd()} (Codex works in the calling directory)`);
  }

  const deadline = opts.waitHours != null ? Date.now() + opts.waitHours * 3_600_000 : null;
  const poll = deadline != null ? pollMs() : null;
  let cooldownUntil = 0;
  let afterReady = false; // the previous wait ended because Codex reported itself ready
  for (let attempt = 1; ; attempt++) {
    exitIfCancelled();
    const retrying = attempt > 1 && record != null;
    const result = await attemptCall({ label: opts.label, record, prompt: retrying ? RETRY_NOTE + prompt : prompt, call });
    record = result.record;
    if (result.ok) {
      const switched = record.model !== model ? ` (this call; label model ${record.model})` : "";
      note(
        `label=${opts.label} action=${result.resumed ? "resume" : "start"} thread=${record.threadId} round=${record.rounds}` +
          ` model=${call.slug}${switched} effort=${call.effort ?? "config"} sandbox=${call.sandbox}` +
          ` log=${result.logFile}`
      );
      const message = result.outcome.message;
      process.stdout.write(message.endsWith("\n") ? message : `${message}\n`);
      return;
    }
    const kind = deadline != null && !result.interrupted ? waitableFailure(result.error) : null;
    if (!kind) {
      if (!call.trace && result.stderr) process.stderr.write(result.stderr);
      die(`${result.failure} [trace: ${result.logFile}]`, result.status);
    }
    if (afterReady) {
      // Codex said it was ready, yet the call hit the limit again: space real calls out.
      cooldownUntil = Date.now() + REAL_RETRY_POLLS * poll;
      note(`Codex reported itself ready, but the call still failed; next real retry not before ${formatTime(cooldownUntil)}`);
    } else {
      note(`${result.failure}; checking Codex's limits every ${Math.round(poll / 1000)} s (no model call) until ${formatTime(deadline)}`);
    }
    const waited = await waitForCodex({ deadline, poll, lastRealAttemptAt: Date.now(), cooldownUntil, failure: result.failure, logFile: result.logFile });
    afterReady = waited.ready;
    if (Date.now() > deadline) die(`${result.failure}; gave up waiting at the --wait deadline (${formatTime(deadline)}) [trace: ${result.logFile}]`);
    note(`${waited.ready ? "Codex is available again" : "retrying without a limits answer"}; attempt ${attempt + 1}`);
  }
}

function printList() {
  let files;
  try {
    files = readdirSync(LABELS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  const rows = files.map((f) => ({ label: f.slice(0, -5), ...readRecord(f.slice(0, -5)) }));
  if (rows.length === 0) {
    process.stdout.write("(no labels)\n");
    return;
  }
  rows.sort((a, b) => String(b.record?.lastAt ?? "").localeCompare(String(a.record?.lastAt ?? "")));
  for (const { label, record, problem } of rows) {
    process.stdout.write(
      problem
        ? `${label}\t(invalid: ${problem})\n`
        : `${label}\tmodel=${record.model}\teffort=${record.effort ?? "default"}\trounds=${record.rounds ?? "?"}` +
            `\tlast=${record.lastStatus ?? "?"} ${record.lastAt ?? ""}\tcwd=${record.cwd ?? "?"}\n`
    );
  }
}

function printHelp() {
  process.stdout.write(
    `four-eyes — one persistent Codex thread per label.

Call (the first call on a label starts its thread; later calls resume it):
  node four-eyes.mjs <label> --prompt-file <path> | --message "text" | --stdin | -- <words>
    --model sol|astra|luna|<model>  model for this call; a new label keeps it (default sol).
                                    A family means its newest model in ${MODELS_CACHE_FILE}.
    --effort <effort>|highest       effort for this call (defaults: sol high, astra medium,
                                    luna highest); a new label keeps it
    --write                         Codex may edit the workspace on this call (else read-only)
    --wait[=hours]                  on a usage limit or no credits, read Codex's limits every
                                    $FOUR_EYES_RECHECK_SECONDS (default ${POLL_DEFAULT_SECONDS} s, no model
                                    call) and retry the same thread once Codex is available
                                    (gives up after ${WAIT_DEFAULT_HOURS} h by default)
    --trace                         stream Codex's events to stderr

Manage:
  --budget          Codex's current usage, resets and credits (no model call)
  --list | --show <label> | --reset <label>

stdout is Codex's reply; stderr has a status line, or the error with its log.
Logs: ${LOG_DIR} (last ${LOG_KEEP}). A label runs one call at a time.
Codex works in the directory the wrapper is called from.
`
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();
  if (opts.budget) {
    let limits;
    try {
      limits = await readRateLimits();
    } catch (err) {
      die(err.message);
    }
    return process.stdout.write(formatBudget(limits));
  }
  if (opts.list) return printList();
  if (opts.show != null) {
    requireValidLabel(opts.show);
    const record = loadRecord(opts.show);
    if (!record) die(`no thread for label: ${opts.show}`);
    return process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  }
  if (opts.reset != null) {
    requireValidLabel(opts.reset);
    acquireLock(opts.reset);
    const existed = existsSync(recordPath(opts.reset));
    rmSync(recordPath(opts.reset), { force: true });
    return process.stdout.write(existed ? `reset: ${opts.reset}\n` : `(nothing to reset for ${opts.reset})\n`);
  }
  await callCodex(opts);
}

// Run the CLI only when executed directly; importing (e.g. from tests) does not.
// Guard argv[1] — a bare dynamic import (`node -e "import(...)"`) leaves it unset.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("exit", () => {
    reaper.reap();
    releaseLock();
  });
  process.stdout.on("error", (err) => (err.code === "EPIPE" ? process.exit(0) : die(err.message))); // e.g. `--list | head`
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      cancelledBy = signal;
      if (currentChild) stopChild(currentChild, signal); // the call or poll then ends, and the run stops
      else die(`interrupted by ${signal}`, 130);
    });
  }
  main().catch((err) => die(err?.stack ?? String(err)));
}
