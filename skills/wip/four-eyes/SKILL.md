---
name: four-eyes
description: >-
  Gain more certainty that what Claude does is right by having an external
  agent, Codex (the OpenAI CLI, also called Chatz), review the plan, the
  implementation and the final state, settling each point in one persistent
  Codex thread. Sol, Astra and Luna name Codex models; Haiku, Claude's
  cheapest. Trigger when the user wants Codex involved ("have Codex review
  this", "ask Chatz", "check this with Codex", "have Sol/Astra/Luna review
  it", "let Codex implement", /four-eyes).
---

# Four Eyes

The goal is more certainty that what we do is right, from an agent outside
Claude. The name comes from the four-eyes principle, but there are usually more
eyes: cheap Haiku sub-agents for specific checks first, then one Sol review that
carries the weight. Haiku goes first because it costs a fraction of Sol: what it
catches doesn't cost a Sol round-trip, and Sol's review isn't spent on the obvious.

**Models**, always the newest version: **Sol**, **Astra** and **Luna** are Codex
(OpenAI) model families; **Haiku** is Claude's cheapest model, run as Claude Code
sub-agents (not external). **Chatz** is Codex working as the second agent.

## The loop

1. **Plan.** The planner writes numbered items (claim, reason, worth doing: yes/no).
   The other side does its own pass, agrees or disagrees with reasons, and adds
   what's missing. Any logic change or design gets this review; only trivial or
   mechanical edits skip it.
2. **Implement** the agreed items.
3. **Review.** The Haiku reviewers (below) look first; fix what's real. Then
   whoever didn't implement reviews the diff, or before/after evidence for changes
   outside Git.
4. **Final check.** Before saying it's done, whoever didn't implement checks the
   end state against the original request: everything asked is done, the relevant
   checks ran, docs match, open points are listed. It can share a call with step 3
   when both look at the same state; any later edit reopens it.

A review or a question with no change is step 1 alone: both look independently,
settle, and tell the user where you agree and where you don't.

Trivial requests (a quick question, a typo) Claude handles directly, unless the
user asks for Codex.

Settle each step before the next. Corrections and follow-ups, including later
requests from the user, go through the same loop; if you changed something before
Codex saw the plan, tell the user. At the end, tell the user what was done, what
was skipped and why, and what is unresolved. Releases follow
[release-flow](../release-flow/SKILL.md).

## Roles

By default the current Claude model (usually Opus) plans and implements, and Sol
reviews. The user can swap either step: Sol plans, implements (`--write`) or
both, and whoever didn't do a step reviews it.

When Sol implements, give it a self-contained brief: verified facts apart from
hypotheses, the exact paths it may read and write, whether it may use the
network, no commit or push, which checks to run, and a report of what it changed
and tested. Both implementing, then Claude combining the two, is only on request
(see [EXAMPLES.md](EXAMPLES.md)).

## Haiku reviewers

Two read-only Haiku sub-agents review each change in parallel:

- **Checklist reviewer:** each changed behavior against a fixed list of risky
  cases (see EXAMPLES.md), marked same, better or worse than the base, with evidence.
- **Gap-hunter:** only the diff and "What does this break that worked before, or
  let through?" No checklist and no explanation, so it doesn't inherit the
  implementer's blind spots.

Claude judges their findings and reads the code only where a finding needs it.
Start each one fresh, never as a fork, so it doesn't see this conversation.
Define them with `model: haiku` and `autoCompactWindow: 100000` in the
sub-agent's frontmatter and keep their reads narrow: above about 100K tokens a
prompt costs several times more, and compaction can't split one large read.
A Haiku sub-agent may also write mechanical, low-risk edits (docs, comments, a
reviewed patch) with tight self-checks; Claude reviews its whole diff as its own.

## Calling Chatz

    # <absolute path to this skill> = the "Base directory for this skill:" path shown when this skill is invoked
    SCRIPT=<absolute path to this skill>/scripts/four-eyes.mjs
    node "$SCRIPT" <label> --prompt-file /tmp/msg.md      # or --message "..."

- **One label per task, reused**: it holds Codex's thread, so send only what's new.
  Open a second label only for separate work running in parallel.
- **Sol** at high for everything. **Astra** to break a tie (see Settling), and
  **Astra** or **Luna** when the user or a skill asks for them:
  `--model astra|luna` (plus `--effort` if needed) on the same label, for one
  call. The user can override any model or effort.
- Every call is read-only unless it passes `--write`: for implementing, or for
  builds and tests that write (then tell Codex to change nothing beyond build
  output); repeat a call blocked by the sandbox with it. Codex works in the
  directory you call from. stdout is its reply.
- Run calls as background tasks of the session (Bash `run_in_background`), not
  detached with `nohup`, so the user sees them and the session is told when they
  end. Detach only around a restart, with a watcher. A task belongs to the
  session that started it; a forked session never stops its parent's tasks.
- `--budget` shows Codex's current usage, resets and credits without a model call.
  Re-check it when picking pending work back up; `--wait` is the fallback.
  `--help` has the rest (`--list`, `--show`, `--reset`, `--trace`).

## Independent, private and cheap

- Put the problem, the diff and the criteria in the message, and your own position
  in a separate file. Ask Codex to write its findings before opening that file.
- What you report (tests pass, a file says X) is a claim; Codex checks the
  important ones itself.
- Unless the user authorizes it, don't give Codex private data. Write the limits
  as an allowlist of paths it may read; naming private folders, even to forbid
  them, leaks them. Ask it to pass the same limits to any sub-agent. Use public
  sources or clearly labeled synthetic examples, and run sanitized reviews
  outside private project directories: Codex starts in the calling directory.
- Batch findings; no rounds just to say "ok". An agreed, concrete correction is its
  own plan. A narrow, unlikely edge case is fixed only if cheap; otherwise note it
  and move on. Wrong data shown to users always counts.

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
model call) and resumes the same thread once Codex is available. If it still
fails, stop and tell the user the exact error; don't carry on alone. A label
locked by a call that died has to be unlocked by hand (the error says how).
