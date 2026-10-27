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

**Haiku reviews.** This change touches gateway errors, retries and query behavior,
so run the checklist reviewer and gap-hunter (D) in parallel, read-only. Claude
judges their findings and fixes what's real before asking Sol.

**Review and final check** (same label, same state):

> **Round 2** — Codex runs the payments tests (`--write`, changing nothing but build
> output) and finds no test for the idempotency key. Claude adds it (an agreed,
> concrete correction is its own plan) and repeats only the affected retry check.
> **Round 3** — Codex: the diff is correct, the request is met, tests pass.
> **Settled.**

Record the reviewed HEAD and working-tree changes, commands/results and finding
dispositions. Report: approved in 3 total rounds; #1, #2, #4 done; #3 deferred as
cosmetic; nothing unresolved. The implementation and final check shared a pass.

---

## B — the user swaps the roles: Sol plans or implements, Claude reviews

**Plan** (read-only, as every call without `--write`):

```
node "$SCRIPT" cache-ttl --message "Plan how to add a TTL to the settings cache in src/cache. Numbered items with reasons; don't edit anything."
```

Claude reviews the plan and settles it with Codex as in A.

**Implement.** Supply a self-contained brief. Replace these example facts and
paths with ones verified in the allowed checkout:

```text
Task: add a TTL to the settings cache in the public checkout /work/project.
Verified facts: the cache has no expiry; its tests cover reads and updates.
Hypothesis to check: a monotonic clock can measure expiry.
Agreed plan: expire entries after the configured TTL; reset expiry on update;
test reads before and after expiry and updates that reset expiry.
Read allowlist: /work/project/**.
Write allowlist: /work/project/src/cache/**, /work/project/tests/cache/**,
and /work/project/build/** for check output only.
Network: forbidden. Use synthetic test data. Don't commit or push.
Run the checkout's documented checks. Report changed files, test commands and
results, and anything unresolved. Don't ask questions; report missing facts.
Pass these read, write and network limits to any sub-agent.
```

Write the brief to `/tmp/cc-cache-brief.md`, then call (this call only may write):

```
node "$SCRIPT" cache-ttl --write --prompt-file /tmp/cc-cache-brief.md
```

Use readable-path allowlists. Never list private folders as forbidden paths.

**Review and final check** by Claude, since Codex implemented: a targeted state
check is sufficient for this narrow change. It finds the TTL isn't reset on update. Claude
reads the relevant code, confirms the finding and sends it with a fix. Codex fixes
it and adds a test (one `--write` call, not a reviewer round). Repeat the state check.
Claude judges them and checks the end state against the request: done.

**Astra**, only because the user asked for an extra look (same thread, one call):

```
node "$SCRIPT" cache-ttl --model astra --message "Take an extra look at the end state against the original request. List anything missing or wrong."
```

The next call without `--model` is back on Sol. The plan review and Astra pass
used 2 external review rounds; neither the implementation nor its fix did.

---

## C — pending work and a usage limit

Re-check availability when resuming pending work:

```
node "$SCRIPT" --budget
```

First read the checkpoint: reviewed snapshot, rounds already used, open IDs,
live task handles and output paths. Inspect completed or partial outputs before
starting a new call. An account change does not start a new review budget.

Don't hold work back or warn about Codex usage. If a call actually fails, report
its exact error. For a usage limit, use `--wait` as the fallback:

```
node "$SCRIPT" cache-ttl --wait --prompt-file /tmp/cc-msg.md
```

Run this as an attached background task. In Claude Code, set Bash
`run_in_background`; don't append `nohup`, `disown` or shell detachment.
The user can see the task and the session gets a completion notice.

It reads Codex's limits every minute (no model call) and retries once Codex is
available, so switching to an account with budget is picked up within a minute.
If the limits can't be read, it retries the call itself every 5 minutes. It keeps
going for up to 2 days (`--wait=<hours>` to change it), whatever reset time Codex
reports; `--budget` shows the same numbers beforehand.

---

## D — the Haiku reviewers and a mechanical writer

When the preflight is justified, run both reviewers read-only in parallel, as
fresh Haiku sub-agents at high effort, each under about 100K tokens of context. Pass the readable-path
allowlist to both. Don't prime either with the implementer's conclusions.

**Checklist reviewer prompt:**

```text
Review each changed behavior against this fixed checklist:
- empty, missing, invalid and boundary inputs;
- errors and partial failures;
- retries and duplicate operations;
- stale state, expiry and updates;
- permissions and verification gates;
- output data and compatibility with existing callers;
- for code that reads files or paths: links (to a file, a folder, the root,
  chains, outside the tree, loops), case and Unicode variants, base versus head,
  a folder where a file is expected, `.`, `..` and empty segments, submodules,
  very large or looping inputs.
Use the diff and base source. Mark each case same, better or worse than the base
version. Give file/line or test evidence. Don't edit files.
```

**Gap-hunter prompt:** provide only the diff and this question, alongside access
limits. Give no checklist or explanation:

```text
What does this break that worked before, or let through?
```

Claude judges the findings and reads code when needed. For a mechanical writer,
allow only named docs or comments, or an already reviewed patch. Require a
scope check, `git diff --check` and the relevant checks. Give it no logic changes.
Claude reads the full resulting diff as if Claude wrote it.

---

## E — the budget ends with a disagreement

The ledger already records 3 external passes: plan, implementation and a
corrective review. Finding F2 remains disputed. Sol proposes a new compatibility
layer; Claude points to the supported-caller contract and a passing regression
test. Neither side brings new evidence, and there is no qualifying high-risk case.

Do not start a fresh label or call Astra. Report `disputed`, the reviewed
snapshot, both positions and their evidence. Do not describe the PR as approved
or ready. Keep any requested PR open with F2 explicit.

## F — CI on a different head

The user asked to open a PR. Tests and review covered head A. A later conflict
fix changed behavior and the live PR is now at head B, with checks pending.

Recheck the affected behavior, run required checks and request a corrective pass
within the remaining budget. Watch CI on B. Report pending, failed, absent or
unavailable checks accurately; neither green CI on A nor a successful push
proves readiness on B. Opening the PR never authorizes merging it.

---

## Notes

- **Both implement.** Start from the same base. Codex works in its own git worktree
  (call the wrapper from there with `--write`); Claude works in the main tree.
  Claude reviews Codex's version and combines the best of both in the main tree,
  then calls the same label from the main tree, read-only, so Codex reviews the
  combined result.
- Keep long calls and services attached to background tasks. Detach only around
  a restart, with a watcher that reports completion or failure on return.
- If every resume of a thread fails with 404 (the thread is gone on the server),
  open a new label and brief it with what was agreed.
- A lock left by a call that died: check with `ps` that its pid is gone, then delete
  the `.lock` file the error names.
