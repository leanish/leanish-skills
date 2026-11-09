---
name: scrutinize
description: >-
  Use when explicitly requested or invoked. Otherwise, offer when a proposed or
  ongoing solution is described as having grown beyond its original scope,
  repeated iterations address the same kind of issue or add complexity without
  resolving the problem, or an important design decision relies on unverified
  factual claims.
---

# Scrutinize

Review the solution against the user's original problem. Catch unnecessary
mechanisms and unsupported claims as well as regressions.

## Coordinator inputs

The agent running this skill coordinates the review. Identify the original
request, acceptance criteria, and the proposal or changes under review. Record the actual
base and reviewed snapshot. Gather relevant usage context, check results, affected
docs and intended public text, such as the PR body and release notes. Define the
focus of each review.

## Reviewer inputs

The coordinator gives each reviewer the original request, acceptance criteria,
proposal or changes under review, assigned role and supporting evidence.

Keep briefs focused. Point reviewers to the repositories, areas or sources
they should inspect. They can follow relevant references as needed and report
missing access or evidence to the coordinator.

Pass public sources or sanitized synthetic examples.
Keep private task notes out of published output.

Each reviewer examines those materials for its assigned role and returns findings
with evidence. Treat the implementer's explanation and test reports as claims
to verify, not independent evidence.

## Independence

Reviewers are read-only and do not launch their own reviewers. For independent
reviews, each reviewer writes findings before seeing the implementer's conclusions
or other review reports. Use a fresh session for correctness reviews, unless
otherwise requested. The coordinator reconciles reports.

## Three review roles

These are responsibilities, not three mandatory calls for every change. Combine
compatible checks for a narrow change; preserve an independent correctness pass
for behavior changes. Linters and formatters cover formatting; legibility belongs
to simplicity. Use [PROMPTS.md](PROMPTS.md) for the role briefs.

1. **Scope and simplicity.** Compare each mechanism with the original problem
   and its evidence. Propose the smallest sufficient solution. Distinguish demonstrated
   needs from hypothetical risks; name removable complexity and its tradeoff.
2. **Claims, docs and publication.** Check changed factual claims in code comments,
   docs, examples and intended public text against primary sources or observed
   output. Check versions, compatibility, counts, claims of testing or past events,
   consistency with behavior, and private references in public output. Missing
   evidence means unverified; narrow/remove the claim or obtain evidence.
   Flag redundant claims across documents and suggest consolidation. Keep
   necessary repetition consistent.
3. **Correctness.** A fresh reviewer checks the actual diff and related code for
   changed behavior, regressions, contracts and instruction misalignments against
   the base. Include existing actionable review threads when reviewing a PR.
   Report concrete consequences with path/line or reproduction evidence, not nits.

Use reviewer and model assignments supplied in the invocation. For unspecified
reviewer assignments, use the cheapest available model at high reasoning effort,
when supported. Report unavailable required reviewers. Without an independent
reviewer, give a self-check with that limit explicit; do not label it independent
approval.

## Evaluate findings

Verify each candidate finding. Keep a stable ID, role, consequence, evidence and
disposition: open, fixed, rebutted or deferred. Rebut with evidence; defer unrelated
work with a reason. Reopen a settled item only for changed code or new evidence.
When scope changes, reassess against the original request, not the last patch.

A small limitation may be accepted with explicit impact and reason within the
user's scope. Calling something known or out of scope cannot excuse a published
falsehood, private-data disclosure or material regression introduced by the change.
Distinguish pre-existing defects from new or worsened ones. Report remaining
blockers with their impact, evidence and the concrete decision needed. Do not
recommend extra mechanisms just to win agreement or infer approval from silence
or tool failure.

## Report

Return **approved**, **changes required**, **disputed** or **review unavailable**,
tied to the reviewed snapshot and review scope. A plan approval covers the plan
only. Include confirmed findings/dispositions, checks actually observed, pending
evidence and accepted limitations. Name roles/reviewers and observed
cost when available; do not invent savings. If required review or material
evidence is missing, do not report approved. The coordinator owns the final verdict.
