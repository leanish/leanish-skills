---
name: chatz-consensus
description: >-
  Work with Codex (the OpenAI CLI), also called Chatz, as a second agent: it
  reviews Claude's plan, implementation and final state, and both argue each point
  in one persistent Codex thread until they agree. Sol, Astra and Luna name Codex
  model families (always the newest version). Claude plans and implements by
  default; Codex plans or implements only when the user asks. Trigger whenever the
  user asks for a review or a second opinion, or wants Codex involved: "review
  this", "second opinion", "ask Chatz", "check this with Codex", "have
  Sol/Astra/Luna review it", "let Codex implement", or /chatz-consensus.
---

# Chatz Consensus

**Chatz** is Codex, the OpenAI CLI, working as a second agent next to Claude.
**Sol**, **Astra** and **Luna** are its model families; naming one means its
newest version.

## The loop

1. **Plan.** The planner writes numbered items (claim, reason, worth doing: yes/no).
   The other side does its own pass, agrees or disagrees with reasons, and adds
   what's missing.
2. **Implement** the agreed items.
3. **Review.** Whoever didn't implement reviews the diff, or before/after evidence
   for changes outside Git.
4. **Final check.** Before saying it's done, whoever didn't implement checks the
   end state against the original request: everything asked is done, the relevant
   checks ran, docs match, open points are listed. It can share a call with step 3
   when both look at the same state; any later edit reopens it.

A review or a question with no change is step 1 alone: both look independently,
settle, and tell the user where you agree and where you don't.

Settle each step before the next. Corrections and follow-ups, including later
requests from the user, go through the same loop; if you changed something before
Codex saw the plan, tell the user. At the end, tell the user what was done, what
was skipped and why, and what is unresolved.

## Roles

|                      | Default | When the user asks             |
|----------------------|---------|--------------------------------|
| Plans                | Claude  | Chatz                          |
| Implements           | Claude  | Chatz (`--write`)              |
| Reviews, final check | Chatz   | Claude, for what Chatz wrote   |

When Chatz implements, say which files, data and network it may use, that it must
not commit or push, and ask for a report of what it changed and tested. Both
implementing, then Claude combining the two, is only on request (see EXAMPLES.md).

## Calling Chatz

    # <absolute path to this skill> = the "Base directory for this skill:" path shown when this skill is invoked
    SCRIPT=<absolute path to this skill>/scripts/chatz-consensus.mjs
    node "$SCRIPT" <label> --prompt-file /tmp/msg.md      # or --message "..."

- **One label per task, reused**: it holds Codex's thread, so send only what's new.
  Open a second label only for separate work running in parallel.
- **Another model = same label, one call**: `--model astra` or `--model luna`, plus
  `--effort` if needed. The next call is back on the label's model.
- Models: **Sol** at high for everything (default). **Astra**, at medium, when the
  user asks or to break a tie. **Luna**, at its highest effort, only when named.
  The user can override any model or effort.
- Every call is read-only unless it passes `--write`. Codex works in the directory
  you call from. stdout is its reply.
- `--budget` shows Codex's current usage, resets and credits without a model call.
  `--help` has the rest (`--list`, `--show`, `--reset`, `--trace`).

## Independent and cheap

- Put the problem, the diff and the criteria in the message, and your own position
  in a separate file. Ask Codex to write its findings before opening that file.
- What you report (tests pass, a file says X) is a claim; Codex checks the
  important ones itself.
- Batch findings; no rounds just to say "ok". An agreed, concrete correction is its
  own plan. When the budget is low, send one self-contained request that says not
  to ask questions.

## Settling

For each open point, concede or rebut with a reason; reopen a settled point only if
something material changes. Stop when nothing is open or the arguments repeat: up
to 5 rounds per debate (10 if still converging). If you don't settle, bring in
Astra on the same label (`--model astra`); if that doesn't settle it either, report
both positions to the user. Never claim an agreement you didn't reach.

## If a call fails

The error names the log (`[trace: …]`). Check it and what Codex already changed, so
a retry doesn't redo it, then retry once. For a usage limit or missing credits,
retry with `--wait` in the background: it checks Codex's limits every minute (no
model call) and resumes the same thread once Codex is available. If it still fails, stop and tell the user the exact error; don't carry on
alone. A label locked by a call that died has to be unlocked by hand (the error
says how).
