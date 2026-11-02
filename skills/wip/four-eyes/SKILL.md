---
name: four-eyes
description: >-
  Use in Claude Code when the user asks for an external Codex review or
  implementation ("ask Chatz", "que Sol lo revise", "have Astra review it",
  "let Codex implement", /four-eyes). Keep review independent, bounded and
  tied to the final state. Requires Node.js and an authenticated Codex CLI.
---

# Four Eyes

The goal is more certainty that what we do is right, from an agent outside
Claude. The name comes from the four-eyes principle, but there are usually more
eyes: optional Haiku sub-agents for specific checks first, then one Sol review
that carries the weight. Use the extra reviewers when their likely findings
justify context transfer and verification; lower model cost alone proves no saving.

**Models**, always the newest version: **Sol**, **Astra** and **Luna** are Codex
(OpenAI) model families; **Haiku** is Claude's cheapest model, run as Claude Code
sub-agents (not external). **Chatz** is Codex working as the second agent.

## Scope and budget

Before review, identify the request, allowed paths, actual target branch and
merge base. Record HEAD and any uncommitted changes, including untracked files.
Do not include, stash or discard unrelated work. The reviewer must inspect the
same snapshot; don't edit scoped files while it runs.

- Allow **3 external review rounds total per task**, across plan, implementation
  and final check. A round is a reviewer pass, not an implementation call.
- Extend to **5 total** only for an evidenced security, permissions, data-loss
  or state/concurrency risk, or the user's explicit request for additional rounds.
  Switching models, labels, accounts or sessions does not reset the budget.
- The first pass covers its whole scope. Later passes cover changed behavior and
  open findings. Purely editorial fixes need no new pass; changes to instructions,
  contracts or documented behavior do, even when the files are Markdown.
- One external reviewer at a time. Reviewers must not launch their own reviewers
  or sub-agents. The owner may run the optional Haiku preflight below.

## The loop

1. **Plan.** The planner writes numbered items (claim, reason, worth doing: yes/no).
   The other side does its own pass, agrees or disagrees with reasons, and adds
   what's missing. Review plans separately when they change contracts, permissions
   or architecture, or the user asks. A focused fix with an established approach
   can combine its plan with the implementation review.
2. **Implement** the agreed items.
3. **Review.** When useful, the Haiku reviewers (below) look first; fix what's real. Then
   whoever didn't implement reviews the diff, or before/after evidence for changes
   outside Git.
4. **Final check.** Before saying it's done, whoever didn't implement checks the
   end state against the original request: everything asked is done, the relevant
   checks ran, docs match, open points are listed. Combine it with step 3 when
   reviewing the same state. Later behavior changes reopen affected findings
   and checks within the remaining budget.

A review or a question with no change is step 1 alone: both look independently,
settle, and tell the user where you agree and where you don't.

Trivial requests (a quick question, a typo) Claude handles directly, unless the
user asks for Codex.

Settle a separately reviewed plan before implementing it. An agreed correction
is its own plan. A new user request can start a new task; continuing the same
change cannot. Releases follow the project's release procedure, or `release-flow`
when installed. For release candidates, `release-flow`'s per-candidate budget
and fresh-thread review exception replace this skill's task-wide budget and
non-implementer rule; its required candidate review sequence still applies.

## Evidence and continuity

Keep a compact record in the existing task notes or an ignored local file:
scope/base, reviewed snapshot, rounds used, reviewer/model, and findings with
stable IDs, severity, evidence and disposition (open, fixed, rebutted or deferred).
Record commands and observed results, not just another agent's claim. For a bug,
prefer a reproduction that fails before and passes after; run the repository's
required checks. Report missing or pre-failing checks separately. A command that
started, timed out or lost its output has no successful result.

Before a long wait or handoff, record the label/thread, live task handles and
output paths, the next action and existing authorization. On resume, inspect
outputs and current Git/PR state before rerunning work. Keep private context out
of commits and PRs. Do not update personal memory unless the user asks.

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

For broad changes or distinct risks, run these two read-only Haiku sub-agents
in parallel, once before the external implementation review. For a narrow change,
use one targeted check or skip the preflight and explain why. Repeat only the
affected check when a later change creates a material new risk.

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
  **Astra** or **Luna** when the user or a skill asks for them: `--model astra|luna` (plus `--effort` if needed) on the
  same label, for one call. The user can override any model or effort.
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

Check each finding yourself. Fix a demonstrated problem with the smallest
change; rebut a false positive with code, tests or output. Defer unrelated work
with a reason. Judge impact using evidence: wrong data shown to users, permission
failures and data loss can matter even on an uncommon path. Do not add a guard,
abstraction or test just to obtain a reviewer's agreement.

Stop when nothing material is open, the same disagreement survives two replies
without new evidence, or the total budget ends. If a round remains, Astra may
arbitrate a concrete dispute on the same label (`--model astra`); it does not add
rounds. Return an explicit **approved**, **changes required**, **disputed** or
**review unavailable** verdict, tied to the reviewed snapshot. Budget exhaustion,
silence and tool failure are never approval. Show unresolved positions and the
evidence the user needs to decide; never hide them behind "done".

## PR handoff, when requested

A review alone authorizes no commit, push, PR comment or merge. If the user also
asked for a PR or PR updates, finish that work and follow through on CI and
review within the authorized scope. Verify bot findings before editing, explain
dismissals when replying is authorized, and keep fixes within the review budget.
Use one attached CI watcher; inspect its result when it ends. Do not treat a
successful watcher exit as proof that every review and merge requirement passed.

Before declaring readiness, read the live PR's head, actual base, checks, reviews
and mergeability. Report checks as passed, pending, failed, absent or unavailable;
absent checks are not green CI. Required approvals and unresolved review requests
remain explicit blockers. Recheck affected behavior after conflict resolution or
other changes; stale review and test results cannot approve the new state.

Report the PR link and final head, review verdict and rounds, proof, deferred
findings and remaining blockers. Leave it open unless merging was separately
authorized; "open a PR" is not merge permission. Never force-push without the
user's explicit ask, or bypass protections. If work cannot continue without a
user decision, use the harness's question tool when available with the PR link,
the blocker and concrete options; unanswered questions do not grant permission.

## If a call fails

The error names the log (`[trace: …]`). Check it and what Codex already changed, so
a retry doesn't redo it, then retry once. For a usage limit or missing credits,
retry with `--wait` in the background: it checks Codex's limits every minute (no
model call) and resumes the same thread once Codex is available. If it still
fails, stop and tell the user the exact error; don't carry on alone. A label
locked by a call that died has to be unlocked by hand (the error says how).
