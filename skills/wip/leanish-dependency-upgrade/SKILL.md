---
name: leanish-dependency-upgrade
description: Use when a repo needs dependency freshness or CVE triage across declared dependencies and related upgrade surfaces such as the Gradle wrapper or GitHub workflow actions before publishing updates.
---

# Leanish Dependencies Upgrade

Triage dependency freshness and CVE exposure with real repo state first. Prefer CLI over browsing unless the web is needed for authoritative version or advisory verification.

## When to Use

- Dependabot PRs exist and should be folded into a manual upgrade branch.
- "Already current" claims need proof from primary sources and the resolved graph.
- Gradle repos need dependency freshness or CVE verification with repo-specific checks such as the wrapper or workflow actions.

## Workflow

1. Resolve the canonical GitHub repo identity before querying PRs or alerts.
- Run `gh repo view --json nameWithOwner,url,defaultBranchRef`.
- Compare it with `git remote -v`.
- If the local remote points at an old owner or moved repo, treat `gh repo view` as the source of truth for GitHub metadata and API calls.

2. Enumerate open PRs before applying filters.
- Start with `gh pr list --state open --limit 30 --json number,title,author,headRefName,baseRefName,url`.
- Do not trust a filtered `--search` query until you have seen the unfiltered open PR set.
- If the user asked about Dependabot PRs, identify them from the returned list first, then inspect them individually.

3. Inventory every upgrade surface before deciding what is current.
- Check direct dependencies declared in Gradle build files.
- Check the Gradle wrapper version in `gradle/wrapper/gradle-wrapper.properties`; treat Gradle itself as part of the upgrade scope, not just the application dependencies.
- Check GitHub Actions versions in `.github/workflows/*.yml` and any local composite actions; treat workflow actions as dependencies that should also be reviewed for current versions.
- Omit `aws-actions/amazon-ecr-login` from workflow-action upgrades unless the user explicitly asks for it.
- Do not conclude "already up to date" from library coordinates alone if the wrapper or workflow actions were not inspected.

4. Prefer a temporary Gradle update plugin for dependency discovery.
- Default to `com.github.ben-manes.versions` as the safest general-purpose Gradle upgrade helper.
- Add it locally, run it to enumerate direct dependency candidates, capture the results, and then remove it before commit or push unless the user explicitly wants it kept.
- Use manual version-by-version checks only to verify the plugin findings, to confirm primary-source latest versions, or when a specific dependency needs extra scrutiny.
- Do not use the plugin as a substitute for checking the Gradle wrapper or GitHub workflow actions.

5. Use open Dependabot PRs as primary upgrade signals.
- Read the exact PR diffs with `gh pr diff <number> --patch`.
- If the task is to fold those updates into the current branch, replay the concrete changes locally instead of paraphrasing them.
- For Gradle wrapper PRs, run `./gradlew wrapper --gradle-version <target>` and then `./gradlew wrapper` so `gradle-wrapper.jar`, launcher scripts, and properties stay aligned with the target version.
- After regenerating wrapper files, review the diff and revert unrelated generated churn before commit; do not publish wrapper-property changes the repo did not need.
- For GitHub Actions PRs, update the workflow `uses:` pins deliberately instead of mentioning them as an aside.
- Skip `aws-actions/amazon-ecr-login` even when reviewing workflow-action upgrades unless the user explicitly asked to include it.

6. Verify what the repo actually resolves.
- Use `./gradlew dependencies --configuration runtimeClasspath`.
- Use `./gradlew dependencies --configuration testRuntimeClasspath` for test-only and transitive exposure.
- Use `./gradlew dependencyInsight --dependency <artifact> --configuration <config>` when a floor or override needs proof.
- Do not claim that a version bump took effect until the resolved graph proves it.

7. Verify versions from primary sources before saying they are current.
- For Maven or Gradle artifacts: use Maven Central metadata or the Gradle Plugin Portal.
- For GitHub Actions: use the official action repository releases or tags.
- For Gradle itself: use official Gradle releases or docs.
- Treat an open Dependabot PR in the canonical repo as strong evidence that a newer supported version exists, and reconcile local claims against it.
- Do not rely on broad search snippets, stale cached pages, or major-tag-only checks.

8. Recheck CVE exposure on the resolved graph, not only on declared versions.
- Check the concrete runtime and test-runtime artifacts that were actually resolved.
- For known advisory families in Java repos, pay special attention to Netty, Apache HttpClient, Commons libraries, Jackson, AWS SDK transitive pulls, and testcontainers-related dependencies.
- Use primary advisory sources when browsing is needed, such as GitHub Advisories, official project security pages, or OSV-backed sources.
- If GitHub Dependabot alerts are disabled for the repository, say that explicitly and do not imply that the absence of alerts means the graph is clean.

9. Only add version floors when they solve a real resolved vulnerability or repo-specific policy need.
- If a vulnerable transitive is present and a direct floor is the cleanest fix, add the explicit dependency with a short `because(...)` reason.
- For Gradle dependencies bumped to fix a CVE, place that explicit floor at the top of the `dependencies` block.
- In that `because(...)`, name the exact CVE ID and say what the floor is fixing; do not leave the security reason vague.
- Keep the reason factual: what version floor is being enforced and which vulnerability or managed-version gap it addresses.
- Do not add floor blocks “just in case” when the resolved graph is already on a safe version.
- If an existing floor was added for a named CVE, remove it once the resolved graph without the floor stays outside that advisory's affected range, even if the fallback version is lower than the old explicit floor.
- Do not keep a CVE-motivated floor only to preserve a higher patch version when the lower resolved fallback is already outside the advisory's affected range.

10. Publish the finished result.
- Once the upgrades and CVE checks are complete, commit the changes, push the branch, and open or update the pull request unless the user explicitly asked to keep the work local.
- Do not stop at a local diff when the user asked for the upgrade to be handled end to end.

## Common Failure Modes

- Empty filtered PR search:
  The likely issue is the query shape or repo identity. Re-run unfiltered `gh pr list` after confirming `gh repo view`.

- “Already current” claim contradicted by open Dependabot PRs:
  The verification source was too weak. Trust the canonical repo’s Dependabot PRs more than generic search results, then confirm with primary release sources.

- Library versions were checked but workflows or Gradle were skipped:
  The upgrade pass was incomplete. Re-check `.github/workflows` action pins and `gradle/wrapper/gradle-wrapper.properties` before concluding the repo is current.

- CVE-motivated floors were left in place after transitive upgrades already solved the issue:
  The upgrade pass left stale constraints behind. Re-check the resolved graph without the floor and remove it if the fallback stays outside the advisory's affected range, even when it resolves lower than the old floor.

- Declared version looks fixed but CVE may remain:
  The resolved graph may still pull an older transitive. Prove the actual resolved version with `dependencies` or `dependencyInsight`.

- Dependabot alerts API is unavailable:
  Check whether alerts are disabled or whether auth scopes are insufficient. Report that limitation explicitly and continue with graph-based triage.

- Temporary updater plugin left behind:
  If you used local-only helper tooling to discover versions, remove it before publishing unless the user explicitly asked to keep it.

- Wrapper regeneration introduced unrelated changes:
  The upgrade pass committed more than the intended version bump. Revert wrapper-file churn that is not required for the target repo before committing or pushing.

## Common Commands

```bash
gh repo view --json nameWithOwner,url,defaultBranchRef
git remote -v
gh pr list --state open --limit 30 --json number,title,author,headRefName,baseRefName,url
gh pr diff 123 --patch
rg -n 'uses: .*@' .github/workflows .github/actions
cat gradle/wrapper/gradle-wrapper.properties
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration testRuntimeClasspath
./gradlew dependencyInsight --dependency io.netty:netty-codec-http --configuration testRuntimeClasspath
./gradlew wrapper --gradle-version 9.5.0
./gradlew wrapper
```
