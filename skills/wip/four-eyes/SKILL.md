---
name: four-eyes
description: >-
  Work with Codex (the OpenAI CLI), also called Chatz, as a second agent: it
  reviews Claude's plan, implementation and final state, and both settle each
  point in one persistent Codex thread. Sol, Astra and Luna name Codex model
  families (always the newest version). Claude plans and implements by
  default; Codex implements when Claude's plan usage is high or the user asks,
  and Claude reviews. Trigger on any question or request where a second opinion
  helps: a diff, a question about code, a law or a past decision, a plan, a
  change; or when the user wants Codex involved ("review this", "ask Chatz",
  "check this with Codex", "have Sol/Astra/Luna review it", "let Codex
  implement", /four-eyes).
---

# Four Eyes

Named after the four-eyes principle: nothing important is done until two agents have looked at it.
**Chatz** is Codex, the OpenAI CLI, working as a second agent next to Claude.
**Sol**, **Astra** and **Luna** are its model families; naming one means its
newest version.

## The loop

1. **Plan.** The planner writes numbered items (claim, reason, worth doing: yes/no).
   The other side does its own pass, agrees or disagrees with reasons, and adds
   what's missing.
2. **Implement** the agreed items.
3. **Review.** Run the cheap reviewers below first. Whoever didn't implement
   reviews the diff, or before/after evidence for changes outside Git. Claude may
   judge the cheap findings instead of reading the whole diff; read code when a
   finding needs it. Review a cheap writer's full diff.
4. **Final check.** Before saying it's done, whoever didn't implement checks the
   end state against the original request: everything asked is done, the relevant
   checks ran, docs match, open points are listed. It can share a call with step 3
   when both look at the same state; any later edit reopens it.

A review or a question with no change is step 1 alone: both look independently,
settle, and tell the user where you agree and where you don't.

Settle each step before the next. Corrections and follow-ups, including later
requests from the user, go through the same loop. Any logic change or design needs
a plan review first; only trivial or mechanical edits may skip it. If you missed
the plan review, tell the user. At the end, tell the user what was done, what
was skipped and why, and what is unresolved.

For releases, use [release-flow](../release-flow/SKILL.md).

## Roles

|                      | Default | Claude usage high, or user asks |
|----------------------|---------|---------------------------------|
| Plans                | Claude  | Chatz, from a brief              |
| Implements           | Claude  | Chatz (`--write`)                |
| Reviews, final check | Chatz   | Claude                          |

Switch when Claude's own plan usage reaches 90% of either its 5-hour or weekly
window, or when the user says so; check usage at the start of substantive steps
when a tool shows it. Claude keeps only work needing the user's
logins, keychain or a judgment call. Work already handed to Codex finishes there.

Give a Codex implementer a self-contained brief: separate verified facts from
hypotheses; allowlist exact readable and writable paths; state whether network
access is allowed; forbid commit and push; require checks and a report of changed
files and test results. Never name private folders, even to forbid them: naming
them leaks them and prompt guards may block the call. Both implementing, then
Claude combining the two, is only on request (see [EXAMPLES.md](EXAMPLES.md)).

## Cheap first reviewers

Review each change with two cheap read-only sub-agents in parallel, before Codex
or instead of Claude reading the whole diff:

- **Checklist reviewer.** Check each changed behavior against a fixed list of
  risky cases. Mark it same, better or worse than the deployed or base version,
  with evidence. See the example checklist in EXAMPLES.md.
- **Gap-hunter.** Give only the diff and: "What does this break that worked before,
  or let through?" Give no checklist or explanation of the implementation.

Keep both independent of the implementer's conclusions. Claude judges findings.
**Claude Code hint:** define each as a sub-agent with `model: haiku` and
`autoCompactWindow: 100000` in its frontmatter, and launch it at high effort.
Start it fresh, never as a fork, so it doesn't inherit this conversation. Keep
its reads narrow: compaction can't split one large read, and prompts above about
100K tokens cost several times more.
A cheap sub-agent may write mechanical, low-risk edits (docs, comments, applying
a reviewed patch) with tight self-checks. Give it no logic changes. Claude reviews
its full diff as if Claude wrote it.

## Calling Chatz

    # <absolute path to this skill> = the "Base directory for this skill:" path shown when this skill is invoked
    SCRIPT=<absolute path to this skill>/scripts/four-eyes.mjs
    node "$SCRIPT" <label> --prompt-file /tmp/msg.md      # or --message "..."

- **One label per task, reused**: it holds Codex's thread, so send only what's new.
  Open a second label only for separate work running in parallel.
- **Models**: **Sol** at high by default. **Astra**, at medium, costs much more:
  use only when the user asks, to break a tie, or for final validation of a state
  Sol found clean. Never call it right after Sol found a blocker; resolve that first.
  **Luna**, at its highest effort, only when named.
  Another model is `--model astra|luna` (plus `--effort` if needed) on the same
  label, for one call. The user can override any model or effort.
- Every call is read-only unless it passes `--write`: for implementing, or for
  builds and tests that write (then tell Codex to change nothing beyond build
  output); repeat a call blocked by the sandbox with it. Codex works in the
  directory you call from. stdout is its reply.
- `--budget` shows Codex's current usage, resets and credits without a model call.
  Re-check it when picking pending work back up; `--wait` is the fallback.
  Don't hold work back to save Codex budget or warn about usage. Report only an
  actual failed call, with its exact error.
  `--help` has the rest (`--list`, `--show`, `--reset`, `--trace`).
- Run long calls attached in the background, so the user can see them and the
  session gets completion notices. **Claude Code hint:** use Bash
  `run_in_background`. Never use `nohup` or `disown` for these calls. Detach only
  around a restart, with a watcher. A background task belongs to the session
  that started it: a forked session never stops its parent's tasks.

## Independent, private and cheap

- Put the problem, the diff and the criteria in the message, and your own position
  in a separate file. Ask Codex to write its findings before opening that file.
- What you report (tests pass, a file says X) is a claim; Codex checks the
  important ones itself.
- Unless the user authorizes it, don't give Codex private data. Allow reads only
  from the readable allowlist. Pass the same limits to any sub-agent. Use public
  sources or clearly labeled synthetic examples; run sanitized reviews outside
  private project directories.
- Batch findings; no rounds just to say "ok". An agreed, concrete correction is its
  own plan. Keep briefs self-contained and say not to ask questions when all
  needed facts and boundaries are supplied.
- Fix a narrow, unlikely edge case only if cheap. Otherwise note it and move on;
  don't spend extra review rounds on it. Wrong data shown to users still counts
  as a bug.

## Settling

For each open point, concede or rebut with a reason; reopen a settled point only if
something material changes. Stop when nothing is open or the arguments repeat: up
to 5 rounds per debate (10 if still converging). If you don't settle, bring in
Astra on the same label (`--model astra`) to break the tie, after resolving any
Sol blocker; if that doesn't settle it either, report both positions to the user.
Never claim an agreement you didn't reach.

## If a call fails

The error names the log (`[trace: …]`). Check it and what Codex already changed, so
a retry doesn't redo it, then retry once. For a usage limit or missing credits,
retry with `--wait` in the background: it checks Codex's limits every minute (no
model call) and resumes the same thread once Codex is available. If it still
fails, stop and tell the user the exact error; don't carry on alone. A label locked by a call that died has to be unlocked by hand (the error
says how).
