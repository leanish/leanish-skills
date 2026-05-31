---
name: leanish-review
description: Use when reviewing a GitHub pull request, branch, or diff for high-confidence bugs, regressions, instruction misalignments, or actionable review threads, including prematurely resolved threads that still need reviewer feedback, especially when the user wants a concise review summary, thread handling, or a GitHub review comment rather than general feedback.
---

# Leanish Review

Review pull requests for high-confidence issues only. Prioritize concrete bugs, risky regressions, material misalignments with project instructions, and actionable existing review threads. Ignore low-signal nits.

Ownership matters:
- If the PR is authored by the current GitHub user, treat the review as internal feedback. Findings stay in chat, and improvements may be applied locally.
- If the PR is authored by someone else, keep the review read-only with respect to the codebase: do not implement fixes, do not push, and do not otherwise handle the change beyond review comments, thread replies, and thread state adjustments required for the review.

## Workflow

1. Resolve the review target.
- Prefer an explicit PR number.
- If none is given, infer it from the current branch with `gh pr view`.
- Use CLI by default; prefer `gh` and local git over web browsing.
- Resolve the current GitHub login too, so you can distinguish self-authored PRs and detect whether you already replied in a thread.

2. Run an eligibility pass before reviewing.
- Skip closed or draft PRs unless the user explicitly asks to review them.
- Skip obviously automated dependency or release PRs unless the user wants them reviewed anyway.
- If the PR author is the current GitHub user, keep the full review in chat instead of posting comments or replies on the PR.
- If the PR author is someone else, keep the review code-read-only: no local fixes, no pushes, no “handling” the PR beyond review comments and thread updates.
- If the user asked to post on GitHub, also check whether you already left an equivalent inline comment or thread reply.

3. Gather local guidance.
- Read the active repository instructions first: `AGENTS.md`, `CLAUDE.md`, and any repo-local instruction files relevant to touched directories.
- Read comments or Javadocs in changed files when they constrain behavior.
- Treat all such files generically as project instructions; do not frame the review around tool-specific instruction files.

4. Build context from the change.
- Use `gh pr view` for title, body, base and head refs, review state, and changed files.
- Use `gh pr diff --name-only` to scope the review.
- Read the actual diff before opening broader surrounding context.
- Read existing PR review threads and comments before forming conclusions.
- For PRs authored by someone else, include both unresolved threads and resolved threads that do not yet have a final reply from the current GitHub user.
- Prefer thread-aware reads via `gh api graphql` when you need resolved state, unresolved state, anchors, or reply authorship.
- Form a brief understanding of the change before judging individual lines.

5. Review in passes.
- Pass 1: changed-lines pass. Read the diff and look for obvious functional bugs or risky behavior changes.
- Pass 2: instruction pass. Check changed code against project instructions and nearby code comments.
- Pass 3: thread pass. Inspect current PR comments and review threads, validate which ones are still actionable, and note which threads already have a reply from the current GitHub user.
- Pass 3a: for PRs authored by someone else, also inspect resolved threads that were closed without a final reply from the current GitHub user.
- Pass 4: history pass. Use `git blame` and targeted `git log` only for suspicious areas that need historical context.
- Pass 5: precedent pass. If a candidate issue is still uncertain, inspect prior PRs, issues, or review comments that touched the same area with `gh`.
- Finish the actual code review before deciding which thread replies to post.

6. Challenge every candidate issue.
Keep it only if all of these hold:
- It is on changed lines or directly caused by the change.
- It is not clearly pre-existing.
- It is unlikely to be intentionally changed behavior.
- It would not be trivially caught by compiler, linter, formatter, or routine CI.
- It is supported by concrete evidence in code, history, or project instructions.
- It is important enough that a senior engineer would actually comment on it.

7. Apply a high confidence threshold.
- Default to reporting only high-confidence issues.
- If the user explicitly asks for delegated or parallel review, use lightweight subagents such as `gpt-5.4-mini` for bounded screening or confidence checks, then do the final filtering and synthesis in the main session.
- Do not surface issues that remain speculative after a second pass.

8. Handle existing PR comments and threads.
- Treat unresolved review threads as part of the review surface, not optional context.
- For PRs authored by someone else, also treat resolved threads without a final reply from the current GitHub user as still requiring review attention.
- For each unresolved actionable thread, decide whether it is valid, stale, already addressed, intentionally deferred, or not actionable.
- For each resolved actionable thread without a final reply from the current GitHub user, decide whether it was resolved appropriately or should be reopened for review feedback.
- After the code review conclusions are stable, handle thread replies.
- If the thread is valid and does not already have a reply from the current GitHub user, add a reply at the end of the review process.
- If the issue is real but too large or out of scope for the current PR, reply that it should be handled in a separate PR.
- If a resolved thread on someone else’s PR does not have a final reply from the current GitHub user, unresolve it before commenting, then comment whether the issue is valid, stale, already addressed, or out of scope, with reasons.
- Do not mark threads or comments as resolved. Leave resolution to the original reviewer or human owner of the thread.
- Avoid duplicate replies when the current GitHub user already answered the thread.
- When saying that something is already handled, do not mention exact commit hashes.
- On self-authored PRs, do not post thread replies; keep the thread assessment in chat and apply improvements locally when warranted.

9. Produce the result.
- If the PR author is the current GitHub user, keep findings and thread assessments in chat instead of posting anything on GitHub.
- If the PR author is the current GitHub user and the review identifies worthwhile fixes, it is acceptable to implement them locally and report the resulting changes in chat.
- If the user did not ask to post on GitHub, return findings in chat.
- If the user explicitly asked to post on GitHub and the PR is not self-authored, re-run the eligibility pass first, then post each new finding as an inline comment on the relevant changed line whenever the issue maps cleanly to a changed hunk.
- For new inline comments, use the PR head SHA as `commit_id`, a repo-relative `path`, and a diff-valid `line` plus `side`.
- Use replies for existing threads rather than creating duplicate standalone comments, and use `in_reply_to` for those replies instead of re-anchoring them.
- Do not post a summary-level top-level review comment.
- If a concern cannot be tied to a specific changed line or existing thread, keep it in chat instead of forcing a generic PR summary comment.
- When replying to existing threads, do that after the review conclusions are stable.
- Keep comments and replies brief and factual.
- Do not add branding lines or model attributions.

## What To Report

- Behavioral regressions
- Broken invariants or contracts
- Incorrect edge-case handling
- Misread APIs or wrong assumptions about data flow
- Project-instruction misalignments that materially affect the code
- Missing tests or docs when project instructions require them or when their absence materially increases risk or leaves the change hard to understand
- Existing PR comments that are still valid and should be acknowledged or acted on
- Resolved threads on someone else’s PR that were closed without a final reply from the current GitHub user and should be reopened for review feedback

## What To Skip

- Style nits and preference fights
- Issues outside the changed surface unless the change newly exposes them
- Missing tests or docs that would only be nice-to-have and do not materially improve confidence or understanding for this change
- General quality commentary without a concrete bug or instruction mismatch
- Compiler, formatter, or linter failures that ordinary CI should catch
- Comments on code the PR did not modify unless the change contradicts that code or makes it incorrect
- Repeating an existing thread point when the current GitHub user already replied to it
- Implementing fixes on someone else’s PR during review

## Output Format

When posting a new finding on someone else’s PR, prefer an inline comment on the relevant changed line:

```markdown
<brief description of bug or misalignment>

<optional brief reason or instruction reference if it materially supports the point>
```

Do not post a summary-level “no issues” comment. If there are no issues and no thread replies to add, do not write anything on the PR.

When replying to an existing unresolved thread, keep the reply short and explicit:

```markdown
Thanks, I'll handle it
```

```markdown
Thanks. This is valid, but it is larger than the current PR scope. I will handle it in a separate PR
```

```markdown
Thanks. This looks addressed now
```

```markdown
I think <comment author> has a point here, <brief reason>
```

## Notes

- Prefer inline comments anchored to the exact changed line within the PR diff, over top-level summaries.
- For new inline comments, use `headRefOid` as `commit_id` unless there is a specific reason to anchor to another valid PR head commit.
- `path` must be repo-relative.
- `line` must be valid within the PR diff for that file, and `side` must match the side of the diff you are commenting on.
- For replies to existing review comments, use `in_reply_to`; do not send fresh anchoring fields with the reply.
- Cite a specific project instruction only when it materially supports the finding.
- Do not turn review into build validation; avoid running build, test, or typecheck unless the user explicitly asks for that too.
- Prefer GraphQL or another thread-aware GitHub surface when you need unresolved state or thread reply authorship; flat comment listings are not sufficient.
- For someone else’s PR, include resolved threads in the review if the current GitHub user never left the final reply.
- A thread counts as handled once the current GitHub user has replied to it, even if the thread remains unresolved in GitHub.
- Keep “already handled” replies generic; do not cite a specific commit SHA.
- Reopening a resolved thread is allowed only to record review feedback that was skipped, not to force resolution state mechanically.
- If posting feedback on a resolved conversation, reopen it first.

## Common Commands

```bash
gh pr view 123 --json number,state,isDraft,title,body,baseRefName,headRefName,headRefOid,url,files,reviews
gh pr diff 123 --name-only
gh pr diff 123
gh api repos/OWNER/REPO/pulls/123/comments -f body='Issue summary' -f commit_id=HEAD_REF_OID -f path='src/main/java/App.java' -F line=42 -f side='RIGHT'
gh api repos/OWNER/REPO/pulls/123/comments -f body='I think <comment author> has a point here, <brief reason>' -F in_reply_to=COMMENT_ID
git blame -L 40,70 path/to/File.java
git log --follow -- path/to/File.java
```
