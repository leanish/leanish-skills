---
name: scrutinize
description: >-
  Use when asked to scrutinize or vet something. Otherwise, offer it when a
  solution has grown beyond its original problem, repeated iterations address
  the same kind of issue or add complexity without resolving it, or an
  important decision relies on unverified factual claims.
---

# Scrutinize

Check the solution against the problem it's meant to solve, catching unnecessary
mechanisms and unsupported claims as well as regressions.

This skill reviews and returns findings and a verdict. It doesn't fix the
change; whoever invokes it may assign the reviewers, and decides what to correct
and whether to review again.

## The packet

Whoever runs this assembles it before any role starts:

- **The problem.** Quote the requester when their words are available. Otherwise
  label what you have as a summary: one written by whoever implemented it carries
  that person's reading of the problem.
- **What actually happened:** the issue, log or run output that shows the
  problem, or "no evidence".
- **What is under review:** the proposal, or the diff with its exact base and
  head commits. For a plan or local changes, identify the material reviewed.
- **Everything published with it:** PR body, CHANGELOG, docs touched and comments
  the change adds.
- **Sources for its factual claims:** primary ones where available, such as
  changelogs, release notes, test and run output.
- **The project's instructions and review guidance,** such as `AGENTS.md`,
  `CLAUDE.md` or a review guide, where they exist, as of the base revision. A
  change to them is part of what is under review.
- **Whether the repository is public.**
- **For a PR, its review threads:** given to a correctness reviewer only after it
  has written its own findings.

The implementer's explanations and test reports are claims to verify, not
evidence.

Reviewers are read-only and launch no reviewers of their own. Give each an
allowlist of what it may read, including the base revision, and no private data;
reports don't reproduce private content. Each writes its findings before seeing
any other review of the change, the implementer's included.

## Roles

These are responsibilities, not mandatory calls. A proposal with no code yet gets
only the scope role. Standalone, roles may share a call on a narrow change, but a
behavior change keeps an independent correctness pass. A typo needs none of them,
unless the user asks. A mechanical edit skips only the scope role; an edit that
changes behavior isn't mechanical.

Use the reviewers the invocation assigns. With none assigned, use the cheapest
available at high effort.

### Scope and simplicity

Whoever didn't write the proposal. It runs before any code exists, and again only
when the scope changes: a new mechanism, area or requirement, not each tweak.
When it runs again, compare the whole solution with the original problem, not
only what changed since the last round.

```text
Here are the problem, the evidence of what happened, and the proposal or diff.
What is the smallest change that solves the stated problem? Name each part that
neither the request nor the evidence calls for, and what could be left out and
stated as a known limitation instead. Don't ask for abstractions for elegance. If the
problem is labeled a summary, say whether it's enough to tell what change was
requested: proving that an incident happened doesn't show that. If the gap
affects your answer, say what's missing. Answer in prose and list only what
isn't justified. If everything is, say so.
```

### Claims, docs and publication

Whoever is assigned. Use the packet first. A reviewer without network can't
fetch primary sources: what it can't confirm stays unverified and goes to a
reviewer who can check it.

```text
Check every factual claim in the change and the published texts: versions,
"tested", "happened", counts, compatibility, names of models or products. Use
primary sources or observed output where you have them. Report only the claims
that aren't confirmed. A claim the evidence contradicts is a defect; missing
evidence means unverified, neither false nor confirmed. For each one that matters, give its location, what's missing and a
narrower wording that would hold. A passing run on X shows X was tested, not
when a feature appeared or the minimum version needed. A started or timed-out
check is not a pass. Then: do the docs match the change, and is
anything stale or contradictory? Where the change repeats a claim, suggest
consolidating it or keep the copies consistent. If the repository is public, is
any private project name or local path present? Say what you couldn't check.
```

### Correctness

Whoever didn't implement, in a fresh context unless the invocation says otherwise.
A flow's own cheap reviewers run as that flow defines them.

```text
Independently inspect the change and related code against the base, the request
and the project's instructions. Look for regressions, broken contracts and
missing verification that materially affects confidence. Verify reported check
results from their output when you can. Separate new or worse issues from
pre-existing ones. Give path and line or reproduction evidence and the affected
behavior. Say what you could and couldn't verify. For a PR, after writing your
independent findings, assess existing actionable review threads in scope against
the reviewed state. Report what still applies as findings.
```

## Findings

Every reviewer checks everything in scope in one pass. Each finding has its
location, a scenario and how it was confirmed, and is one of:

- **Confirmed defect:** always reported, of any severity. Needs a fix or a
  known-limitation note.
- **Unverified:** important ones are reported. Get the source, narrow the claim or
  drop it. One a reader would act on that stays unverified makes the verdict
  incomplete.
- **Preference:** labeled. It never blocks or justifies more complexity.

When a defect is one instance of a pattern, name its other instances in what is
under review, so one round can fix them all. An instance you came across outside
it that the base already had, and that the change doesn't make worse, is
pre-existing: report it for a separate change, and don't search for more. It
doesn't block this change, but report a leak or anything exploitable first and
keep it out of public text (see below). One the change causes or worsens belongs
to this review, wherever it is.

Whoever runs this verifies each finding and records it as open, fixed, rebutted or
deferred; short IDs help. A settled point reopens only for changed code or new
evidence. Don't recommend extra mechanisms just to win agreement.

A confirmed defect blocks when it is a regression, a false published statement, a
leak, or a part the stated problem doesn't need and the requester didn't ask for.
That it was deliberate, or that CI would catch it, doesn't discard it. A release
candidate uses release-flow's "What blocks" instead.

A small defect may become a known limitation, with its impact and reason. A
published falsehood, a leak, a material regression or an unneeded part may not.
A limitation someone could exploit before it's fixed stays out of all public
text: follow "Exploitable limitations" in
[release-flow](../release-flow/SKILL.md).

## Report

Return the verdict and the head or material it covers. A later edit needs the affected roles again.
Put findings that determine the verdict first, then order the rest by impact,
with preferences last. Do not infer "no changes required" from silence or tool
failure.

- **No changes required:** a review result, not an approval to merge. When there
  are no findings, say so plainly.
- **Changes required.**
- **Disputed:** reviewers still disagree after the evidence; give both positions.
- **Incomplete:** material evidence is missing, the scope reviewer said a summary
  isn't enough, or a required reviewer is unavailable.

With no reviewer other than whoever implemented it, it's a self-check: its
verdict is at best incomplete, since a required reviewer is missing. For each role,
say who reviewed, whether the review was unprimed or continued a thread, the
confirmed and dismissed findings with why, and the time and tokens when observed.
