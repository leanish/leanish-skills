import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCodexArgs, parseModelsCache, parseTurnOutcome, resolveModel, resolveSessionSettings } from "./chatz-check.mjs";

const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n");

test("captures thread id, usage, and the final agent message from a successful turn", () => {
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
  assert.equal(out.usage.input_tokens, 100);
  assert.equal(out.error, "");
});

test("prefers the -o last-message text over the agent_message event", () => {
  const stdout = lines({ type: "item.completed", item: { type: "agent_message", text: "from stream" } });
  assert.equal(parseTurnOutcome(stdout, "  from -o file \n").message, "from -o file");
});

test("falls back to the agent_message event when the -o text is empty", () => {
  const stdout = lines({ type: "item.completed", item: { type: "agent_message", text: "fallback" } });
  assert.equal(parseTurnOutcome(stdout, "   ").message, "fallback");
});

test("surfaces a quota/credit failure from error and turn.failed events", () => {
  const stdout = lines(
    { type: "thread.started", thread_id: "019eX" },
    { type: "turn.started" },
    { type: "error", message: "Your workspace is out of credits." },
    { type: "turn.failed", error: { message: "Your workspace is out of credits." } }
  );
  const out = parseTurnOutcome(stdout, "");
  assert.equal(out.error, "Your workspace is out of credits.");
  assert.equal(out.threadId, "019eX"); // thread still captured even on failure
});

test("takes the first thread id and the last usage/message when several appear", () => {
  const stdout = lines(
    { type: "thread.started", thread_id: "first" },
    { type: "thread.started", thread_id: "second" },
    { type: "item.completed", item: { type: "agent_message", text: "older" } },
    { type: "turn.completed", usage: { input_tokens: 1 } },
    { type: "item.completed", item: { type: "agent_message", text: "newest" } },
    { type: "turn.completed", usage: { input_tokens: 2 } }
  );
  const out = parseTurnOutcome(stdout, "");
  assert.equal(out.threadId, "first");
  assert.equal(out.message, "newest");
  assert.equal(out.usage.input_tokens, 2);
});

test("ignores non-JSON noise lines without throwing", () => {
  const stdout = ["Reading additional input from stdin...", "", JSON.stringify({ type: "thread.started", thread_id: "ok" }), "garbage{"].join("\n");
  assert.equal(parseTurnOutcome(stdout, "done").threadId, "ok");
});

test("a new label runs on GPT-6 Sol at high, read-only, unless flags say otherwise", () => {
  assert.deepEqual(resolveSessionSettings(null, {}), {
    sandbox: "read-only",
    model: "sol",
    effort: "high",
  });
  assert.deepEqual(
    resolveSessionSettings(null, { sandbox: "workspace-write", model: "astra", effort: "high" }),
    { sandbox: "workspace-write", model: "astra", effort: "high" }
  );
});

test("a resumed label keeps its recorded settings and ignores flags", () => {
  const existing = { sandbox: "read-only", model: "gpt-6-sol", effort: "high" };
  assert.deepEqual(
    resolveSessionSettings(existing, { sandbox: "danger-full-access", model: "gpt-6-astra", effort: "xhigh" }),
    existing
  );
});

test("a legacy record without model or effort leaves them to config.toml", () => {
  assert.deepEqual(resolveSessionSettings({ sandbox: "read-only", model: null }, {}), {
    sandbox: "read-only",
    model: null,
    effort: null,
  });
});

const HIGH = [{ effort: "medium" }, { effort: "high" }];
const cacheOf = (...models) => () =>
  JSON.stringify({ models: models.map(([slug, visibility = "list", levels = HIGH]) => ({ slug, visibility, supported_reasoning_levels: levels })) });

test("a family alias resolves to its newest listed version, ignoring hidden and other families", () => {
  const cache = cacheOf(["gpt-5.6-sol"], ["gpt-6-sol"], ["gpt-6-astra"], ["gpt-7-sol", "hide"], ["gpt-6-luna"]);
  assert.equal(resolveModel("sol", "high", cache), "gpt-6-sol");
  assert.equal(resolveModel("astra", "high", cache), "gpt-6-astra");
});

test("versions compare by integer components", () => {
  assert.equal(resolveModel("sol", "high", cacheOf(["gpt-6.9-sol"], ["gpt-6.10-sol"])), "gpt-6.10-sol");
  assert.equal(resolveModel("sol", "high", cacheOf(["gpt-6-sol"], ["gpt-6.1-sol"])), "gpt-6.1-sol");
  assert.equal(resolveModel("sol", "high", cacheOf(["gpt-7-sol"], ["gpt-6.5-sol"])), "gpt-7-sol");
});

test("a concrete model id or a missing model passes through without reading the cache", () => {
  const unreadable = () => {
    throw new Error("cache must not be read");
  };
  assert.equal(resolveModel("gpt-6-sol", "high", unreadable), "gpt-6-sol");
  assert.equal(resolveModel(null, null, unreadable), null);
});

test("no matching model, or a newest model without the effort, fails instead of downgrading", () => {
  assert.throws(() => resolveModel("astra", "high", cacheOf(["gpt-6-sol"])), /no listed gpt-<version>-astra/);
  const newestLacksHigh = cacheOf(["gpt-6-sol"], ["gpt-7-sol", "list", [{ effort: "low" }]]);
  assert.throws(() => resolveModel("sol", "high", newestLacksHigh), /gpt-7-sol does not support effort "high"/);
});

test("an invalid model cache fails clearly", () => {
  assert.throws(() => parseModelsCache("not json"), /invalid Codex model cache/);
  assert.throws(() => parseModelsCache("{}"), /no "models" array/);
  assert.throws(() => resolveModel("sol", "high", () => "{}"), /no "models" array/);
});

test("a new label passes --sandbox; a resume passes the recorded sandbox as a config override", () => {
  const common = { sandbox: "read-only", model: "gpt-6-sol", effort: "high", lastMsgFile: "/tmp/last.txt" };
  const tail = ["--model", "gpt-6-sol", "-c", 'model_reasoning_effort="high"', "-"];
  assert.deepEqual(buildCodexArgs(common), ["exec", "--json", "--skip-git-repo-check", "-o", "/tmp/last.txt", "--sandbox", "read-only", ...tail]);
  assert.deepEqual(buildCodexArgs({ ...common, threadId: "019eX" }), [
    "exec", "resume", "019eX", "--json", "--skip-git-repo-check", "-o", "/tmp/last.txt", "-c", 'sandbox_mode="read-only"', ...tail,
  ]);
});

test("a record without model or effort leaves both to config.toml", () => {
  const args = buildCodexArgs({ threadId: "019eX", sandbox: "workspace-write", model: null, effort: null, lastMsgFile: "/tmp/l" });
  assert.equal(args.includes("--model"), false);
  assert.equal(args.some((a) => a.startsWith("model_reasoning_effort")), false);
  assert.deepEqual(args.slice(-3), ["-c", 'sandbox_mode="workspace-write"', "-"]);
});
