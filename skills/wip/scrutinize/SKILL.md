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
- **What's already known:** settled facts, exclusions and the state of the
  sources, each with its source, such as work that's out of scope, a stale base
  or a mode that doesn't exist. Mark assumptions as such. None of it excuses a
  regression the change causes.
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

Use the reviewers the invocation assigns; an assignment replaces these defaults
entirely. With none assigned, the roles that apply go to:

1. **Haiku sub-agents** (Claude's cheapest model) at high effort, in parallel,
   launched by whoever runs this: the claims reviewer, and for a diff the
   checklist reviewer and the gap-hunter.
2. **Sol** (Codex) at high effort, in a fresh context, takes scope and
   correctness in one exhaustive pass. Only after writing its own findings does
   it get the Haiku findings, and it confirms, rebuts or re-rates each with
   evidence. A blocker found in step 1 doesn't skip step 2.
3. **Astra** (Codex's stronger, costlier model) at medium effort continues Sol's
   thread, unless a confirmed blocker remains; then the report says it was
   skipped. For a proposal with no code, it runs only when asked. It's the one
   reviewer that starts from the earlier findings instead of its own pass. It
   looks for missed issues and wrong dispositions and returns the final list:
   each finding confirmed, rebutted or re-rated with its evidence, plus what was
   missed.

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
Two cheap reviewers support it, each with only the input named below.

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

**Checklist reviewer:** the diff and the base source.

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
Mark each case same, better or worse than the base version. Give file/line or
test evidence. Don't edit files.
```

**Gap-hunter:** only the diff, this question and the access limits. No packet,
checklist or explanation, so it doesn't inherit the implementer's blind spots.

```text
What does this break that worked before, or let through?
```

## Findings

Every reviewer checks everything in scope in one pass. Before reporting a
finding, try to disprove it with the smallest check your access allows: a test,
a one-line script, a search. A documentation observation needs no executable
check. Each finding has its location, the quoted code or claim when it helps, a
scenario and how it was confirmed; short IDs help when there are several. A
material finding you can't support is reported as unverified: severity doesn't
replace evidence. Each finding is one of:

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

Whoever runs this records each finding as open, fixed, rebutted or deferred. It
verifies itself the findings it acts on and every dismissal or downgrade that
changes the verdict. A rebuttal or downgrade without verifiable evidence leaves
the point disputed; one it can't resolve with evidence goes to the user with both
positions. A settled point reopens only for changed code or new evidence. Don't
recommend extra mechanisms just to win agreement.

A confirmed defect blocks when it is a regression, a false published statement, a
leak, or a part the stated problem doesn't need and the requester didn't ask for.
That it was deliberate, or that CI would catch it, doesn't discard it. The
caller's own blocking rules, such as a release process's, take precedence.

A small defect may become a known limitation, with its impact and reason. A
published falsehood, a leak, a material regression or an unneeded part may not.
A limitation that lets someone do more than their access already allows stays
out of all public text until it's fixed: report it privately to whoever invoked
this, whose process handles disclosure and the fix.

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
