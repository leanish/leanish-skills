---
name: scrutinize
description: >-
  Check a proposal or a change against the problem it is meant to solve: is it
  bigger than the problem needs, are its claims true, do the docs match, does
  it leak anything, does it break anything. Use when the user asks to
  scrutinize or vet a plan, branch, PR or release candidate ("is this
  overbuilt?", "are these claims right?"), or when four-eyes or release-flow
  call for one of its roles.
---

# Scrutinize

A reviewer given only a diff can tell whether the diff works. It can't tell
whether the diff was needed or whether what's written about it is true. Each
role here gets what it needs to answer that, and a role that didn't get it says
so instead of passing.

## The packet

Assemble it before any role runs:

- **The problem, in the requester's own words,** quoted. A summary by whoever
  implemented it carries that person's reading of the problem.
- **What actually happened:** the issue, log or run output that shows the
  problem, or "no evidence".
- **The proposal, or the diff** with its exact base and head commits.
- **Everything published with it:** PR body, CHANGELOG, docs touched and comments
  the diff adds.
- **Sources for its factual claims:** changelogs, release notes, test and run output.
- **Whether the repository is public.**

A run that includes the scope role but lacks the requester's words is
**incomplete**, never a pass. A verdict covers only the head it names; a later
edit needs the affected roles again.

Give every reviewer an allowlist of what it may read, including the base
revision, and no private data, and have it pass those limits to any sub-agent.

## Roles

A proposal with no code yet gets only the scope role; a change gets all three.
A typo needs none of them, unless the user asks. A mechanical edit skips only
the scope role; an edit that changes behavior isn't mechanical.

Start each Haiku sub-agent fresh, never as a fork, so it doesn't see the
conversation, and at high effort. Define them with `model: haiku` and
`autoCompactWindow: 100000` in the sub-agent's frontmatter and keep their reads
narrow: above about 100K tokens a prompt costs several times more, and compaction
can't split one large read. Don't prime any of them with the implementer's
conclusions. Whoever runs them judges the findings and reads the code only where
a finding needs it.

### Scope and simplicity

Whoever didn't write the proposal, by default Sol. It runs on the proposal before
any code exists. Whoever is implementing calls it again only when the scope
changes: a new mechanism, area or requirement, not each tweak. Judge against the
original problem, never against the previous round.

```text
Here are the problem in the requester's words, the evidence of what happened,
and the proposal or diff. What is the smallest change that solves the stated
problem? Name each part that neither the request nor the evidence calls for,
and what could be stated as a known limitation instead. Answer in prose and
list only what isn't justified. If everything is, say so.
```

### Claims, docs and publication

One read-only Haiku sub-agent (in Codex, the cheapest read-only sub-agent). It
has no network: what it can confirm comes from the packet and the checkout, and
it says what it couldn't check. Unverified claims that matter go to the external
reviewer.

```text
List every factual claim in the diff and the published texts: versions,
"tested", "happened", counts, compatibility, names of models or products. Give
for each the source in this packet that confirms it, or "unverified". Then:
do the docs match the diff, and is anything stale or contradictory? If the
repository is public, is any private project name or local path present?
```

### Correctness

Two read-only Haiku sub-agents in parallel first (in Codex, the cheapest
read-only sub-agents); fix what's real; then an external reviewer.

**Checklist reviewer**, given the diff and the base source:

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

**Gap-hunter**, given only the diff and the access limits, no checklist or
explanation, so it doesn't inherit the implementer's blind spots:

```text
What does this break that worked before, or let through?
```

**External reviewer:** whoever didn't implement, given the packet, the related
code and the test results. It looks for regressions and says what it could and
couldn't verify. Standalone and in release-flow it starts from a fresh context.
Within four-eyes, when Sol reviews, the task's own thread does it, and the report
says it wasn't unprimed. If Sol implemented, Claude is this reviewer.

## Findings

Every reviewer makes one exhaustive pass and reports everything, each finding
with its location, a scenario and how it was confirmed, as one of:

- **Confirmed defect:** needs a fix or a known-limitation note.
- **Unverified:** get the source or drop the claim. One a reader would act on
  that stays unverified makes the verdict incomplete.
- **Preference:** reported, and never a reason to grow the solution.

A confirmed defect blocks when it is a regression, a false published statement, a
leak, or a part the stated problem doesn't need and the requester didn't ask for.
That it was deliberate, or that CI would catch it, doesn't discard it. A release
candidate uses release-flow's "What blocks" instead.

A small defect may become a known limitation, with its impact and reason. A
published falsehood, a leak, a material regression or an unneeded part may not.
A limitation someone could exploit before it's fixed stays out of all public
text: follow "Exploitable limitations" in
[release-flow](../release-flow/SKILL.md).

## The loop

The caller's loop governs: four-eyes' Settling, or release-flow's new candidate.
Standalone: batch the findings, make one round of fixes, re-review only what
changed. If it's still blocked, take a concrete decision to the requester.
Running out of rounds is never approval.

## Calling an external reviewer

When Sol reviews from Claude Code, use the four-eyes wrapper (see "Calling Chatz"
and "Independent, private and cheap" in [four-eyes](../four-eyes/SKILL.md)), on a
new label when the review must start fresh. In Codex, use a fresh sub-agent.

## Report

End with the verdict (pass, blocked or incomplete) and the head it covers. For
each role: confirmed findings, dismissed findings and why, time and tokens, and
whether the external review was unprimed or continued a thread.
