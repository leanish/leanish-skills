---
name: harden-workflows
description: >-
  Audit and harden GitHub Actions workflows to reduce what untrusted code in
  CI (a dependency, a build plugin, a compromised action) can do with the
  job's credentials: token permissions per job, persisted checkout
  credentials, actions pinned by commit SHA, secrets, write jobs that run
  build code, and publishing split from building. Use when the user asks to
  audit, review or harden CI workflows, check what a dependency could do in
  CI, pin actions, set persist-credentials, or make publishing safer, for one
  repository or all of an owner's.
---

# Harden Workflows

Any code a job runs can use any credential that job holds: a dependency, a Gradle or npm plugin, a test, an action.
Nothing inside a job isolates one step's credentials from code an earlier step ran. So the goal is to reduce
exposure and keep write capabilities out of jobs that run build code; judge a workflow by what its credentials are
worth if that code is hostile. Background, sources and the scripts' contract: [REFERENCE.md](REFERENCE.md).

## Workflow

1. **Inventory.** `scripts/fetch-workflows.sh <owner> <empty dir> [repo...]` saves the default branch's workflows of
   the repositories `gh` can see (archived ones skipped), then `node scripts/audit.mjs <dir>` prints one row per job:
   triggers, *declared* permissions, write scopes, referenced secrets (named ones, `(dynamic)` for a computed index,
   `(all)` for the whole context), checkouts, external refs (unpinned ones
   marked) and whether it has steps that *may* run repository code. The table finds candidates; it doesn't resolve
   called workflows, workflow-level `env`, or what an action runs (Gradle's dependency submission builds the project
   without a `run:` step). Read the workflows and the actions before judging a row.
2. **Check each job** against the rules below. Record repository, file, job, rule, and what the credential could do if
   stolen. A blank secrets cell doesn't mean no credential: `id-token: write` mints OIDC tokens a registry may trust.
3. **Fix** cheapest and safest first: missing `permissions`, write scopes wider than the job, persisted checkout
   credentials, floating action refs, then structural splits. `node scripts/harden.mjs --pins <pins.json> <file>...`
   edits files in place (persist-credentials, pins); it refuses files it can't edit safely, including a checkout that
   already sets `persist-credentials`, so pass only files that need it. Edit a clone, then open PRs.
4. **Verify.** Re-run the audit on the edited files, parse every edited file, check that no job needs git credentials
   after checkout (`git push`, fetching private repositories or submodules, `gh` without an explicit token), and
   require green CI on every PR. Say what CI didn't exercise (workflow_dispatch jobs, publishing).
5. **Report** what was fixed, what remains and why, per repository.

## Rules

- **Every workflow declares `permissions:`**, `contents: read` at the top; a job that needs more declares it itself.
- **Write scopes only on the job that writes**, and that job runs no repository code (no checkout-and-build, no
  repository scripts, no local action); it consumes what a read-only job produced.
- **`actions/checkout` sets `persist-credentials: false`** unless a later step needs git credentials. It narrows
  exposure to file readers; it doesn't remove the token from the runner.
- **External actions and reusable workflows are pinned to a full commit SHA with the version as a comment**
  (`@<sha> # v1.2.3`); container actions (`docker://`) to an image digest (`@sha256:…`). Local refs take
  no `@ref`: `./.github/workflows/x.yml` runs the caller's commit, `./action` whatever the workspace holds (what
  was checked out). Pin the commit the ref already resolves
  to: pinning isn't a version change. If that release is too new for the project's release-age policy, report it
  instead of silently pinning an older one.
- **Secrets only where used**, never `secrets: inherit` to a workflow that builds, and none reachable from
  `pull_request_target` or `workflow_run` jobs that check out or run the triggering PR's code.
- **Publishing**: build, check and summarize what will be published in a read-only job; publish the exact handed-over
  files from a job with only the write scope, behind a protected environment. Verify that protection exists (an
  `environment:` that doesn't exist yet is created unprotected) and, for OIDC publishing, what the registry trusts.
  Details: [REFERENCE.md](REFERENCE.md#publishing-split).

## Don't

- Don't change what a workflow does beyond the hardening (no refactors, no version bumps).
- Don't move a pin a person set deliberately (a comment says why) without asking.
- Don't call a split safe before it has run for real: PR CI rarely exercises publishing.
