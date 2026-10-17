---
name: budget-roles
description: >-
  Swap who implements and who reviews between Claude and Codex (Sol) by the
  token budget each one has left, and keep long work going across usage
  limits. Use alongside four-eyes on substantive work, or when the user
  mentions Claude's or Codex's usage, limits, credits or resets.
---

# Budget Roles

[four-eyes](../four-eyes/SKILL.md) sets who plans, implements and reviews. This
skill moves those roles by budget, so neither agent runs out halfway through.
The user's explicit choice always wins over these rules.

## Check

- **Claude:** check plan usage (the 5-hour and weekly windows) at the start of
  each substantive step. Claude Code hint: the desktop app's session usage tool.
- **Codex:** `four-eyes.mjs --budget` (no model call), when a step is about to
  hand Codex work.
- Never warn the user about usage or hold work back to save budget. Report only a
  call that actually failed, with its exact error.

## Swap

| Claude's usage (either window) | Plans | Implements | Reviews |
|---|---|---|---|
| below 90% | Claude | Claude | Sol |
| 90% or more | Claude or Sol | Sol (`--write`) | Haiku first, then Claude judges |
| Codex out of credits | Claude | Claude | waits for Sol (`--wait`) |

- Work already handed to one agent finishes there, even if the budgets change.
- When Sol implements, Claude reads the Haiku reviewers' reports and Sol's
  summary, and reads code only where a finding needs it. Claude keeps what needs
  the user's logins or keychain and any judgment call.
- Reviews that carry weight (a release's unprimed review and last review) always
  stay with Codex. If Codex is out, wait for it; never substitute Haiku or Claude.

## Keep going across a limit

- **5-hour window:** the session keeps its context. Once the window passes 75%
  during long unattended work, schedule a one-shot task a few minutes after the
  reset whose only job is to tell this session to continue where it stopped.
  Re-arm it at each reset while the work continues; below 75%, don't arm it.
- **Weekly window:** only when it is about to run out, write a handoff file so a
  later session can resume. Handoffs are costly; don't write them for the
  5-hour window.
