# Four Eyes — worked examples

`SCRIPT=<absolute path to this skill>/scripts/four-eyes.mjs`, where `<absolute path to this skill>` is the
"Base directory for this skill:" path shown when the skill is invoked. One label for the whole task, so Codex keeps
every round.

---

## A — Claude plans and implements (default)

**Plan.** Claude writes its findings to `/tmp/cc-payments-review.md`:

```
1. [worth doing: yes] `refundOrder` swallows the gateway error, so a failed
   refund looks successful. Wrap and rethrow with context.
2. [worth doing: yes] N+1: `loadLineItems` queries once per item.
3. [worth doing: no] Rename `tmp` to `pending`: cosmetic.
```

and asks Codex:

```
node "$SCRIPT" payments-review --prompt-file /tmp/cc-msg.md
```

where `/tmp/cc-msg.md` says: *"Review the payments change (`git diff`) for
correctness and error handling. Write your findings first. Then read my review in
/tmp/cc-payments-review.md and compare: agree or disagree with each item, with
reasons, and add what I missed."*

> **Round 1** — Codex agrees on #1–#3 and adds #4: a retried refund can pay twice
> without an idempotency key. **Claude:** concedes #4. **Settled:** #1, #2, #4;
> #3 skipped.

**Implement.** Claude makes the three changes.

**Review and final check** (same label, same state):

> **Round 1** — Codex reads the tests and the results Claude ran and attached, and
> finds no test for the idempotency key. Claude adds it (an agreed, concrete correction is its own plan).
> **Round 2** — Codex: the diff is correct, the request is met, tests pass.
> **Settled.**

Report: #1, #2, #4 done; #3 skipped as cosmetic; nothing unresolved.

---

## B — the user asks Codex to plan and implement (and, this time, for Astra too)

**Plan** (read-only, as every call without `--write`):

```
node "$SCRIPT" cache-ttl --message "Plan how to add a TTL to the settings cache in src/cache. Numbered items with reasons; don't edit anything."
```

Claude reviews the plan and settles it with Codex as in A.

**Implement** (this call only may write):

```
node "$SCRIPT" cache-ttl --write --message "Implement items 1–3. Only touch src/cache and its tests; use only the repo's files, no network. Run the tests. Don't commit or push. Report what you changed and the test results."
```

**Review and final check** by Claude, since Codex implemented: Claude reads the
diff, finds the TTL isn't reset on update, sends the finding with a fix; Codex
fixes it and adds a test (one `--write` call). Claude re-checks the end state
against the request: done.

**Astra**, only because the user asked for an extra look (same thread, one call):

```
node "$SCRIPT" cache-ttl --model astra --message "Take an extra look at the end state against the original request. List anything missing or wrong."
```

The next call without `--model` is back on Sol.

---

## C — a usage limit

```
node "$SCRIPT" cache-ttl --wait --prompt-file /tmp/cc-msg.md    # run in the background
```

It reads Codex's limits every minute (no model call) and retries once Codex is
available, so switching to an account with budget is picked up within a minute.
If the limits can't be read, it retries the call itself every 5 minutes. It keeps
going for up to 2 days (`--wait=<hours>` to change it), whatever reset time Codex
reports; `--budget` shows the same numbers beforehand.

---

## Notes

- **Both implement.** Start from the same base. Codex works in its own git worktree
  (call the wrapper from there with `--write`); Claude works in the main tree.
  Claude reviews Codex's version and combines the best of both in the main tree,
  then calls the same label from the main tree, read-only, so Codex reviews the
  combined result.
- A process that must outlive Codex's call (a dev server, a watcher) has to be
  started detached.
- If every resume of a thread fails with 404 (the thread is gone on the server),
  open a new label and brief it with what was agreed.
- A lock left by a call that died: check with `ps` that its pid is gone, then delete
  the `.lock` file the error names.
