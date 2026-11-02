---
name: release-flow
description: >-
  Default rules for releasing a project: cutting and validating release
  candidates (rc tags, real runs, reviews), what blocks a release, the release
  PR, tagging and publishing, starting the next development version, and
  repinning adopters. Use when the user asks to prepare, cut, tag, publish or
  validate a release or an rc, open or merge a release PR, or repin consumers
  after one.
---

# Release Flow

Follow repo-specific release docs (for example, `docs/releasing.md`) for that
repo's specifics. Use these defaults otherwise. This flow works in both agents.

## Release candidates

- Tag the candidate commit on main with a lightweight `v<version>-rc.<n>` tag.
  Candidate and release tags never move. Fixes get new candidates.
- Run the thing for real from a checkout of the candidate. Use real CLIs or
  services with synthetic or test data, never private data. Run on the adopters
  where the release's changes apply. Unit tests with fakes are not enough.
  Verify effects yourself (files, PRs, CI); don't trust a model's report.

Review each candidate in order. Start each step only if the previous step found
no blocker. Fix a blocker on main through its own PR, then tag a new candidate
and start again at step 1.

1. **Cheap reviewers** (Haiku sub-agents in Claude Code). Run two read-only
   reviewers in parallel on `git diff v<deployed> v<rc>`. Use `git show v<deployed>:<file>` for comparison.
   A checklist reviewer checks inputs, partial failures, retries, state,
   permissions and compatibility, with same/better/worse evidence against the
   deployed release. A gap-hunter gets only the diff and "What does this break
   that worked before, or let through?" Give it no checklist or implementation
   explanation. In Codex, use available read-only sub-agents; report unavailable
   reviewers rather than silently substituting models required by the user.
2. **Unprimed review.** Sol reviews the whole state on a fresh thread or label,
   even if Sol implemented some of the release (the fresh thread keeps it
   independent). This is the release-specific exception to `four-eyes`'s
   non-implementer rule. Give the request, deployed/candidate SHAs, access limits
   and check results, not where to look, the implementer's conclusions or what
   step 1 found. Reviewers do not start their own reviewers.
3. **Last review, by Astra.** Only when every check on the candidate passed (real
   runs, CI, steps 1 and 2 found no blocker): Astra, with Sol's findings from step 2,
   for one last review. With the optional `four-eyes` wrapper, use Sol's thread
   and `--model astra`; otherwise use a native reviewer session. It challenges Sol's findings,
   looks for what was missed, and checks each finding against the deployed
   release. Astra costs much more than Sol, so it never runs on a candidate that
   still has a known blocker.

Run the final unprimed review on the last candidate, before the release PR,
release tag and repins. Never defer it until after the release.

## Candidate convergence and continuity

Keep one candidate record for the release: immutable SHA, deployed baseline,
observed real-run/check results, stable finding IDs, disposition and review
rounds. Carry fixed, rebutted and pre-existing findings forward. A fresh reviewer
first writes independent findings; only then reconcile them with the record.
Do not reopen a settled finding without changed code or new evidence.

For release candidates, this per-candidate budget replaces `four-eyes`'s
task-wide budget. Use at most 3 review rounds per candidate; each
reviewer stage is one round (the parallel cheap pair is one stage). A corrective
review of an unchanged candidate uses a remaining round, never an extra automatic
pass. A code or behavior fix requires a new immutable candidate and the full
sequence, even if rounds remain. Allow up to 5 only for an evidenced security,
permissions, data-loss or state/concurrency risk, or the user's explicit request
for additional rounds. An unresolved finding at the limit remains a blocker.
Never skip a required stage to fit the budget or call exhaustion approval.

After 3 failed candidates in the same release, stop the fix-one/tag-one cycle.
Classify recurring findings against the deployed baseline, identify the shared
cause, and batch known blockers into a reviewed correction before tagging again.
Report candidate count, recurring blockers and the proposed next correction.
If the same dispute repeats without new evidence or no bounded correction is
available, keep the release blocked and ask the user for a concrete scope decision.
This checkpoint does not relax the release gates or allow shipping known regressions.

Before a wait, quota change or handoff, record current candidate, reviewer
labels/threads, live task handles, output paths and the next step in local task
notes. On resume, inspect those outputs and live remote state before repeating
runs or creating a candidate. Do not copy private session content into release PRs.

## What blocks

- Block only on findings new or worse than the deployed release: weakened
  verification or gates, wrong data, or aborted runs. The implementer judges each
  finding against this rule; don't treat every finding as required work.
- A tool that skips something with a visible note doesn't block.
- Document pre-existing problems as known limitations and fix them in the next
  release. Holding every release for old problems keeps the deployed release,
  which has them all, running longer.
- Record per candidate what each reviewer added: a finding others missed, one
  rightly overturned, or only time and tokens spent. After the release, report
  what each model contributed and its rough cost.

## Release PR

- Keep the release PR to release metadata: the version change (drop `-SNAPSHOT`,
  or set the root version) and the dated CHANGELOG heading. Feature PRs document
  the upcoming version; they never change the version itself.
- Right before merging, verify main is still at the candidate's commit. On the
  release PR branch, verify `git diff v<rc> HEAD` shows only release metadata.
  Anything else needs a new candidate and the full review sequence.
- Require green CI on the release PR's head. Watch CI yourself in the background
  and continue on green; don't wait for the user or rely on auto-fix bots.
  Diagnose failures first: rerun failed jobs for environment failures or flakes;
  fix real bugs through the normal loop and make a new candidate.
- Distinguish passed, pending, failed, absent and unavailable checks. No checks
  or inaccessible CI does not satisfy the green-CI gate. Re-read the live head,
  base, approvals, review requests and mergeability immediately before merging;
  evidence from an earlier head cannot satisfy the current gate. Ask for explicit
  approval before an administrative bypass, even when ordinary merge is authorized.
- Update PR branches by merging main, not rebasing. Never force-push without the
  user's explicit ask. Merge only when the user asked for it or explicitly
  authorized the current flow.

## Tag and publish

- Squash-merge, then tag `v<version>` at the exact merge commit. Use the full merge
  SHA as the target, not a branch tip. Create the GitHub release with the fixes
  and a link to the CHANGELOG. Publish packages to external registries only with
  the user's explicit OK.
- Right after publishing, open a PR that only starts the next development
  version (for example, `X.Y.(Z+1)-SNAPSHOT`), adds the new CHANGELOG heading and
  updates docs pointing at it. Keep main carrying the next development version;
  no other PR changes it.

## Adopters and deployment

- Pin consumers by full commit SHA with the version as a comment:
  `uses: owner/repo/.github/workflows/x.yml@<full-sha> # v<version>`.
  Require green checks on the repin PRs. A repository rename's redirect does not
  cover reusable-workflow `uses:`; repin with the new name.
- Install released tools from the release commit in a stable checkout outside
  temp directories. Keep the user's configs and secret services. Never put
  credentials in Git, release notes, scheduling files or agent input.
- Delete worktrees and branches only once verifiably merged.

## Tool hints

- **CLI:** watch CI with `gh pr checks <n> --watch --interval 60` as a background
  task. With `gh release create`, pass the full merge SHA as `--target`.
- **Claude Code:** use Bash `run_in_background` for long calls and CI watchers.
- **Codex:** use an attached background task that reports completion to the
  session. Keep the task visible to the user.
