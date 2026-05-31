---
name: leanish-cleanup
description: Use during or after coding work when code may benefit from simplification, cleanup, consistency improvements, readability improvements, maintainability improvements, or behavior-preserving refactoring. Apply to newly written code, recently modified code, review follow-up, opportunistic cleanup near touched code, or broader codebase passes when the user asks for repo-wide refinement.
---

# Leanish Cleanup

Simplify recently touched code while preserving exact functionality. Favor clear, explicit, maintainable code over clever or overly compact rewrites.

## Scope

- Default to code modified in the current session or the user's recent changes.
- Expand to broader files only when the user explicitly asks for a wider simplification pass.
- Preserve public behavior, outputs, side effects, validation, error handling, and contracts.

## Workflow

1. Identify the recently modified code and read enough surrounding context to understand its responsibilities.
2. Read the active project instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, repo conventions) before making stylistic changes.
3. Look for small, behavior-preserving simplifications that improve clarity and consistency.
4. Apply focused refinements instead of broad rewrites.
5. Run the relevant verification for the touched area before concluding that the simplification is safe.
6. Mention only the significant refinements that materially help future readers understand the code.

## Rules

### Preserve Functionality

- Never change what the code does. Change only how clearly it expresses the same behavior.
- Keep all existing features, outputs, side effects, and externally visible contracts intact.
- Preserve error semantics unless the user explicitly asks for a behavior change.

### Apply Project Standards

- Follow the active repository guidance and the local language or framework conventions.
- Prefer explicit names, contracts, nullability, and error handling over implicit behavior.
- Keep import, formatting, typing, and framework patterns aligned with the surrounding codebase.
- Do not force habits from another stack onto the current project.

### Improve Clarity

- Reduce unnecessary complexity and nesting.
- Use guard clauses and early returns when they make control flow easier to follow.
- Eliminate redundant code, indirection, and obvious comments.
- Consolidate related logic, but keep responsibilities separated.
- Prefer readable conditionals over dense expressions.
- Avoid nested ternary operators; use clearer branching when multiple conditions are involved.

### Keep Balance

- Do not collapse distinct concerns into one function or class just to reduce line count.
- Do not replace a useful abstraction with a dense one-liner.
- Do not widen scope into unrelated cleanup unless it is adjacent, low risk, and clearly improves the touched code.
- Choose clarity over brevity.

## Output

- Keep changes small, surgical, and easy to review.
- Focus on the code that was recently modified unless the user asks for more.
- Document only the changes that affect understanding; avoid noisy summaries.
