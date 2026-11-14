# Harden Workflows: reference

Why each rule in [SKILL.md](SKILL.md) holds, what it doesn't cover, and how the scripts behave.

## The threat

A job runs code its authors didn't write: dependencies resolved at build time (including versions still inside a
release-age wait, when someone takes a security fix early), build plugins, test frameworks, and every action it
uses. Any of them can read the job's environment and files, start processes and make network calls. On GitHub-hosted
Linux runners the job's user also has passwordless `sudo`, so it can read the memory of the runner process
(`Runner.Worker`) that holds the job's token and secrets; the March 2025 `tj-actions/changed-files` compromise did
exactly that to print secrets into logs
([StepSecurity's analysis](https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised)).
So:

- **Whatever a job can use, code in that job can steal**, and passing a secret only to the last step doesn't stop
  code an earlier step started. Limit what the job holds, not where it's hidden.
- A stolen `GITHUB_TOKEN` is scoped to the repository and to the job's `permissions`, and expires when the job ends
  (at most 6 hours on GitHub-hosted runners, 24 on self-hosted;
  [docs](https://docs.github.com/en/actions/concepts/security/github_token)). With `contents: read` it reads that
  repository's code, which the runner already checked out; for a public repository that's nothing new. Write scopes
  are what turn a dependency compromise into a publish, a push or a release.
- Secrets (registry tokens, cloud keys) outlive the job and leave the repository's scope: they matter most.
- `id-token: write` lets the job mint OIDC tokens; what they're worth depends on who trusts them (npm trusted
  publishing, a cloud role). Check that trust: owner, repository, workflow file and environment it requires.

## permissions

- Without a `permissions:` key the token gets the repository's (or organization's) default, which may be write-all
  on older repositories. A job-level key replaces the top level for that job. A scope not listed is `none`.
- A reusable workflow gets the caller job's permissions and can only lower them; its own `permissions:` lowers them
  further ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)).
  The audit shows the caller's declaration, so read the called workflow before calling a row a write job.
- By default, `pull_request` runs from forks get a read-only token and no secrets; a private repository's fork
  policy can allow write tokens and secrets
  ([settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)).
  `pull_request_target` and `workflow_run` can reach the base repository's token and secrets, so they must never
  check out or run the triggering PR's code with them.

## persist-credentials

- `actions/checkout` puts the token where later git commands find it. Up to v5 that was `.git/config` in the
  workspace; from v6 it's a separate file under `$RUNNER_TEMP`, included from `.git/config`. Either way, any later
  step can read it.
- `persist-credentials: false` uses the token for the fetch and leaves no copy behind. The token is still in the
  runner's memory (see the threat), so this stops code that reads files, not code that dumps memory. Cheap, worth
  it, not sufficient alone.
- A step that needs git credentials later (pushing a branch, fetching a private submodule) gets them explicitly,
  e.g. `git -c credential.helper='!gh auth git-credential' fetch ...` with `GH_TOKEN` on that step only.

## Pinning

- A tag (`@v7`) is a mutable ref: whoever controls the action's repository can move it, and every workflow using it
  runs the new code next time. A full 40-character commit SHA can't be moved. The same goes for reusable workflows
  (`owner/repo/.github/workflows/x.yml@<sha>`). Container actions (`docker://image`) pin to an image digest
  (`@sha256:<64 hex>`); the scripts don't handle those: the audit marks them unpinned and harden.mjs won't edit them.
- Resolve a tag to its commit with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` (the commits endpoint
  dereferences annotated tags). Check that the version in the comment points to the same commit. Prefer immutable
  releases (`gh api repos/<owner>/<repo>/releases --jq '.[] | "\(.tag_name) \(.immutable)"'`).
- Pinning freezes what the ref resolves to today; it isn't a version change. If today's release is too new for a
  release-age policy, report it and let a person choose between taking it and an older pin (moving back can undo a
  security fix).
- A pin is only as good as the action's own dependencies: a composite action or one that downloads tools at run time
  can still pull moving code. Note those as gaps. Keep pins current with a tool that understands SHA pins plus
  version comments (Dependabot, Renovate, bump-it).

## Write jobs

A job with a write scope (`contents`, `packages`, `id-token`, `pull-requests`, `actions`, `deployments`...) should run
only pinned, reviewed actions and short inline scripts that don't execute repository code. Typical shapes:

- **Dependency graph submission:** a read-only job generates the graph (`dependency-graph: generate-and-upload`; this
  runs the build), a second job with `contents: write` only submits it (`download-and-submit`).
- **Comments, labels, statuses:** compute in a read-only job, write from a job that reads the result as data.
- **Caches:** a write job that restores a cache the build populated restores files the build wrote; don't execute
  them.

## Publishing split

Build and publish in one job means every dependency runs holding the publish credential. Split it:

1. **prepare** (`contents: read`): check out, build, run the checks, stage the exact files to publish, write a
   summary (commit, coordinates, version, files) to the step summary, and hand the files over with a manifest (paths,
   sizes, SHA-256): job outputs (base64) for small payloads, `actions/upload-artifact` for larger ones. The summary
   comes from prepare because the protected job doesn't run until it's approved.
2. **publish** (only the write scope, `environment:` with protection): no checkout and no build tool; fetch the
   hand-over, verify it against the manifest, upload with a short inline script or the registry's own CLI.

Before calling it safe: the environment must exist with a required reviewer (naming one that doesn't exist creates
it with no protection; required reviewers depend on the plan and the repository's visibility), and for OIDC
publishing the registry's trust must name this repository, workflow and environment.

Registry notes:

- **npm:** `npm pack` in prepare, `npm publish <tarball>` in publish with trusted publishing (`id-token: write`, no
  long-lived token). Check the tarball's integrity in publish before uploading.
- **Maven repositories you upload to file by file (GitHub Packages, Nexus, Artifactory):** stage with a file
  repository in the build (`publishing.repositories.maven { name = "Staging"; url =
  uri(layout.buildDirectory.dir("staging")) }`, then `publishAllPublicationsToStagingRepository`), not
  `publishToMavenLocal`, whose metadata differs from a remote deploy. The hard part is `maven-metadata.xml`: a fresh
  staging directory only knows the new version, and SNAPSHOTs need timestamped names and per-version metadata, so
  uploading staged metadata as-is can drop earlier versions from the listing. Seed staging with the remote metadata
  first, upload artifacts and checksums before metadata, and abort if the remote metadata changed in between. Test
  how the registry treats raw PUTs of metadata against a disposable target before trusting the design. Gradle plugin
  markers are separate POM-only publications.
- **Maven Central (Central Portal):** publishes uploaded bundles through its own API, not file-by-file PUTs; stage
  the bundle in prepare and upload it in publish.

## Scripts

- `fetch-workflows.sh <owner> <out-dir> [repo...]`: needs `gh` authenticated; reads each repository's default branch
  through the API, so it sees only repositories that login can read. Default: every non-archived repository of the
  owner. Refuses a non-empty `out-dir`; writes `<out-dir>/<repo>/<workflow file>`.
- `audit.mjs <dir>`: reads that layout, prints TSV with a header row. Needs the `yaml` package resolvable (run from a
  directory where it's installed, or set `NODE_PATH`); exits 2 if it isn't.
- `harden.mjs --pins <pins.json> <file>...`: edits the files in place (no dry run: work on a clone). `pins.json` maps a
  floating ref to its pin, same action on both sides:

  ```json
  { "actions/checkout@v7": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1" }
  ```

  It edits text so comments and layout survive, and refuses a file (non-zero exit, that file untouched) when a
  floating ref already has a comment, a checkout already sets `persist-credentials` (even to `false`), or the layout
  is one it can't place a key in safely. It also refuses a file with a value it can't delimit, since text inside it
  could look like a step: an anchor or tag before a value (`&name`, `!!str`), a tab before a value, a space before a
  key's `:`, a flow collection (`{…}`, `[…]`) that doesn't close on its line, or a quoted sequence item spanning
  lines. Files processed before a refusal stay edited: check `git status`.

## Out of scope

Branch protection and rulesets, who can approve environments, self-hosted runner hardening, and the registry's own
account security are settings, not workflow edits; verify the ones a finding depends on (see the publishing split)
and report the rest.
