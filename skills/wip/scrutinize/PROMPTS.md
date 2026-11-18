# Scrutinize — role briefs

The coordinator selects a role brief below and supplies the corresponding inputs
from [SKILL.md](SKILL.md), following its independence rules. Use actual paths and
check outputs; do not paste private session history or expected findings.
Reviewers report findings with evidence; the coordinator decides their disposition
and the overall verdict.

## Scope and simplicity

```text
Compare the proposal/diff with the user's original problem and the evidence.
Which mechanisms satisfy a requirement? Which solve only a hypothetical problem?
Describe the smallest sufficient approach and any material tradeoffs. Flag scope
growth with specific locations. Do not request abstractions merely for elegance.
Read only; no nested reviewers. Give findings with consequence and evidence, or
state no findings and the limits of what you checked.
```

For example, a request to disable background work does not by itself justify a
new output protocol. Establish the separate failure before requiring that design.

## Claims, docs and publication

```text
Inspect changed factual claims in comments, docs, examples and proposed public
text. Check important claims against primary sources or observed output:
versions/compatibility, counts, tests claimed and what actually happened. Check
that docs match behavior and that public text contains no private references.
Flag redundant claims across documents and suggest consolidation. Keep necessary
repetition consistent.
For each unsupported consequential claim, give its location, missing evidence
and a narrower defensible wording or verification needed. Unavailable evidence
means unverified, not false or confirmed. Do not reproduce private content in
your report. Read only; no nested reviewers.
```

A passing run on version X proves X was tested; it does not establish that a
feature first appeared in X. Prefer that narrower statement without a primary
source for the introduction version. A started or timed-out check is not a pass.

## Correctness

```text
Independently inspect the diff and relevant surrounding code against the base,
original request and project instructions. Look for concrete regressions, broken
contracts and missing verification that materially affects confidence. For a PR,
assess existing actionable review threads too. Verify important reported check
results from output when available. Separate new/worse issues from pre-existing
ones. Give path/line or reproduction evidence and the affected behavior. State
verification limits. Read only; no nested reviewers or speculative style nits.
```

For example, a later conflict fix changes the reviewed snapshot. Prior approval
and passing checks cannot establish correctness of its affected behavior.
