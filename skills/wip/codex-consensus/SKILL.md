---
name: codex-consensus
description: >-
  Work with Codex (the OpenAI CLI), also called Chatz, as a second reviewer:
  Claude and Codex review plans, changes and answers, argue each point in one
  persistent Codex thread, and settle on what to do. Every plan goes to Codex, and
  every implementation is reviewed by whoever didn't write it, follow-ups included.
  Claude implements by default; Codex
  implements, or both do and Claude combines them, only when the user asks.
  Trigger when the user wants agreement with Codex or Chatz: "agree with Codex",
  "settle/validate/cross-check this with Codex", "have Codex weigh in", "ask
  Chatz", "check/validate this with Chatz", "preguntale / concordá / validá con
  Chatz", or /codex-consensus. Do NOT trigger on a plain "review this", "is this
  correct?" or "second opinion" that doesn't mention Codex, Chatz or agreement.
---

# Codex Consensus

Codex is also called **Chatz**. Use it as an independent second reviewer: each side
argues its points until you agree, and no change starts before its plan has gone
through the settle loop.

## Talking to Codex

```
# <absolute path to this skill> = the "Base directory for this skill:" path shown when this skill is invoked
SCRIPT=<absolute path to this skill>/scripts/codex-converse.mjs
node "$SCRIPT" <label> --prompt-file /tmp/msg.md   # long messages
node "$SCRIPT" <label> --message "..."             # short ones
```

- **One label per task, reused.** The label keeps Codex's thread, so send only what
  is new.
- One call at a time per label; different labels can run in parallel.
- stdout is Codex's reply. stderr shows label, thread, round and `thread_tokens`
  (the thread's running total, not this round's).
- Helpers: `--show <label>`, `--list`, `--reset <label>`.

## Keeping the review independent

- Put the problem, the diff and the criteria in the message, and your own position
  in a separate file. Ask Codex to write its findings in an interim message before
  opening that file, then compare. The log records the order.
- What you report (tests pass, a file says X) is a claim. Codex checks the
  important ones itself, with the smallest check that settles them.

## Questions

For a question with no change, keep the review independent: send the question and
the evidence, and your draft answer in a separate file that Codex reads after its
own interim answer. Settle, and tell the user where you agree and where you don't.

## Changes

1. **Plan.** Write numbered items (claim, reason, worth handling: yes/no). Codex
   does its own pass, agrees or disagrees with reasons, and adds what you missed.
   Codex doesn't edit files while planning, even if its label can write. Settle.
2. **Implement** the agreed items (see **Who implements**).
3. **Review.** Whoever didn't write it reviews it: the diff, or before/after
   evidence for changes outside Git (config, data, memory). Settle.

Every correction goes through the same loop, including ones the user asks for
later: plan, settle with Codex, then edit. If you changed something before Codex
saw the plan, tell the user; Codex reviews the plan, and whoever didn't implement
reviews the result.

At the end, report what was done, what was skipped and why, and what is unresolved.

## Who implements

Codex works in the directory the wrapper is invoked from, with the sandbox stored
in the label's record (`~/.claude/codex-converse/labels/<label>.json`).

- **Claude** (default). The label stays `read-only` (the wrapper default).
- **Codex**, only when the user asks. Open the label with
  `--sandbox workspace-write`, or edit `sandbox` in its record to keep the thread,
  and set it back to `read-only` when Codex goes back to reviewing. In the request,
  say which files, data and network access it may use, that it must not commit or
  push unless asked, and ask for a report of changes and tests.
- **Both**, only when the user asks. Start from the same base. Codex works in its
  own git worktree (label in `workspace-write`, wrapper invoked from there) and
  Claude in the main tree. Claude reviews Codex's version and combines the best of
  both in the main tree. Then set the label to `read-only` and invoke it from the
  main tree, so Codex reviews the combined result.

Check a `danger-full-access` record before reusing it.

## Settling

For each open point, concede or rebut with a reason. Reopen settled points only if
something material changes.
Stop when nothing is open, or when the same arguments repeat.

- Up to 5 rounds per debate (10 if it is still converging). Count them yourself:
  the wrapper's `round` counts every call on the label.
- If you don't settle, escalate to Astra (below). If that fails too, decide
  yourself and tell the user where you disagreed. Never claim an agreement you
  didn't reach.

## Model

- Codex runs on the **latest GPT Sol at `high`**. `sol` and `astra` are aliases
  that the wrapper resolves on every call to the newest version in Codex's model
  list, so new releases are picked up on their own.
- Use the **latest GPT Astra** (`--model astra --effort high`) when the user asks,
  when Sol says it can't solve the task, or when a debate doesn't settle. Astra gets
  its own label, `<label>-astra`, reused on later escalations of the same task. The
  first time, tell it what is agreed, what is open and both positions. If
  the user asked for Astra or Sol couldn't solve it, stay on Astra; otherwise go
  back to Sol once the point is settled.
- Flags only set up a new label. To change the model, effort or sandbox of an
  existing thread and keep its memory, edit its record.

## If a call fails

For any failure (credits, capacity, network, crash): check the log if the error
provides one (`[trace: …]`) and deal with anything Codex already changed, so the
retry doesn't repeat it; then retry once. If it fails again, stop and tell the user the exact error. Don't carry
on alone.

- A failed call doesn't update the wrapper's record, though the log and Codex's
  thread may hold work. If the label existed, retrying resumes the same thread.
- If a *first* call fails after real work, its log has the `thread_id`: recreate
  the record (`threadId`, `sandbox`, `cwd`, `model`, `effort`) instead of starting
  over, and check it with `--show`.
- A process that must outlive Codex's run has to be started detached.
- If every resume of a thread returns 404 after a failed server-side summary,
  confirm it and open a new label.

Every call's log is in `~/.claude/codex-converse/logs/`; `--trace` also prints the
full event stream. See [EXAMPLES.md](EXAMPLES.md) for worked examples.
