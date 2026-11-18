---
name: pr-description
description: >-
  Use when writing or updating a pull request's description (gh pr create,
  gh pr edit --body). Gives the section layout, which sections are
  always needed and which only when they help, so a reviewer knows how to read
  the change.
---

# PR description

A reviewer should know, in the first lines, what changes and why, and then where to look. Use these sections, in
this order, as `##` headings. Leave out an optional one rather than filling it with nothing.

| Section | When | What goes in it |
| --- | --- | --- |
| In short | always | Two to four sentences: what changes and why, and who is affected. Someone who stops here knows what they'd approve. |
| Background | optional | Terms or mechanisms the reader needs and the code doesn't show. Skip it when In short is enough. |
| Problem | unless In short covers it | What's wrong or missing today, with the evidence: an issue, a run, a log line, an example. |
| Solution | unless In short covers it | What the change does, per area or file. Add a `### What changes for users` under it when behavior or an API changes. |
| Tests | when code, build, dependencies or behavior change | Tests added or changed, and which checks ran with what result. Say what didn't run (no Docker, no network). |
| Notes for reviewers | optional | Where to look closely, known limits, decisions taken on someone's call, anything deliberately left out. |
| Review history | optional | Once a review changed the PR: what changed after it and why, in a few lines. Not a transcript. |

## Rules

- If the reason isn't obvious from the problem, give it in In short's first sentence.
- Every claim is something you saw: test output, a run, a source. Write "not run" or "not checked" rather than guess.
- Write about this project's change. From a dependency, say only what decides this change (an advisory, a breaking
  change) and link the rest.
- A small change keeps a small description: a version bump can be In short (what and why) and Tests (one line on
  what ran), with no other headings.
- If the PR isn't meant to merge as is (a proposal, a draft for discussion), say so in one line above In short.
- Link issues and PRs (`Closes #N` where it should close one).
- In a public repository: no private project names or machine-local paths (repository-relative files like
  `build.gradle.kts` are fine).
- Keep the description current: when a later commit changes what the PR does, update the affected sections.
