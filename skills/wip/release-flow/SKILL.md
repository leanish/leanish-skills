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
   Follow [four-eyes](../four-eyes/SKILL.md): a checklist reviewer checks each
   changed behavior against fixed risky cases, with same/better/worse evidence;
   a gap-hunter gets only the diff and "What does this break that worked before,
   or let through?" Give the gap-hunter no checklist or implementation explanation.
2. **Unprimed review.** Sol reviews the whole state on a fresh thread or label,
   even if Sol implemented some of the release (the fresh thread keeps it
   independent). Give only what to review, not where to look or what
   step 1 found.
3. **Last review, by Astra.** Only when every check on the candidate passed (real
   runs, CI, steps 1 and 2 found no blocker): Astra, on Sol's thread from step 2
   (`--model astra`), for one last review. It sees and challenges Sol's findings,
   looks for what was missed, and checks each finding against the deployed
   release. Astra costs much more than Sol, so it never runs on a candidate that
   still has a known blocker.

Run the final unprimed review on the last candidate, before the release PR,
release tag and repins. Never defer it until after the release.

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
