# Chatz Consensus — worked examples

`SCRIPT=<absolute path to this skill>/scripts/chatz-consensus.mjs`, where `<absolute path to this skill>` is the
"Base directory for this skill:" path shown when the skill is invoked.

One label for the whole task, so Codex keeps every round.

---

## Example A — Claude implements (default)

**Plan.** Claude reviews the payments change and writes its findings to
`/tmp/cc-payments-review.md`:

```
1. [worth handling: yes] `refundOrder` swallows the gateway error, so a failed
   refund looks successful. Wrap and rethrow with context.
2. [worth handling: yes] N+1: `loadLineItems` queries once per item.
3. [worth handling: no] Rename `tmp` to `pending`: cosmetic.
```

Then asks Codex (first call, read-only by default):

```
node "$SCRIPT" payments-review --prompt-file /tmp/cc-msg.md
```

where `/tmp/cc-msg.md` says: *"Review the payments change (`git diff`) for
correctness and error handling. Write your findings in a message first. Then read
my review in /tmp/cc-payments-review.md and compare: agree or disagree with each
item, with reasons, and add anything I missed. Don't edit files."*

> **Round 1** — Codex agrees on #1 and #2, would keep #3 (trivial), and adds #4: a
> retried refund can pay twice without an idempotency key.
> **Claude:** concedes #3 and #4. **Settled:** #1–#4.

**Implement.** Claude makes the four changes.

**Review** (same label):

> **Round 1** — Codex runs the payments tests itself and finds no test for the
> idempotency key. **Claude:** agrees and plans the test; Codex agrees; Claude adds
> it.
> **Round 2** — Codex: correct. **Settled.**

Report: #1–#4 done, nothing unresolved.

---

## Example B — the user asks Codex to implement

Same plan, but the label is opened writable:

```
node "$SCRIPT" payments-review --sandbox workspace-write --prompt-file /tmp/cc-msg.md
```

**Implement** (same label):

```
node "$SCRIPT" payments-review --message "Implement #1–#4. Only touch src/payments and its tests. Run the tests. Don't commit or push. Report what you changed and the test results."
```

**Review.** Claude reads Codex's diff:

> **Round 1** — #2's batch query loses the `position` order the caller needs.
> Claude sends the finding with a plan: order by `position` and add a test.
> **Round 2** — Codex agrees, fixes it and adds the test. Claude re-checks:
> correct. **Settled.**
