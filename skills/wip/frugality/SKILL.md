---
name: frugality
description: >-
  Use when the user asks to reduce execution cost, save tokens or work within
  a limited budget ("más barato", "economizá tokens", "frugality"). Choose
  batching, delegation and verification by expected total cost.
---

# Frugality

- Choose the approach with the lowest expected total execution cost.
- Look for batch operations or small scripts when possible.
- Delegate to a sub-agent running the latest available Luna model at its maximum supported effort, using `fork_turns=none`, when its expected total execution cost—including context transfer, coordination, and verification—is lower than completing the work directly.
- When using a cheaper sub-agent, the main-agent should still perform the planning and final verification.
- If Luna or sub-agents aren't available, do the work yourself.
- Extra waiting time is acceptable when it reduces cost.
- Independent research can be delegated as bounded questions.
- Before delegating repetitive execution of an unfamiliar workflow, the main agent should verify that the procedure works end to end.
- Preserve the workflow's review budget across models and resumed sessions. Reuse settled findings and valid evidence; do not restart the review for each comment, or repeat unchanged checks merely to report progress. Repository-required checks still run.
- Before a long wait or handoff, leave a compact checkpoint with the current state, task handles, output paths and next action. On resume, inspect completed and partial outputs before retrying. Task intent or a started process is not completion evidence.
- Ask for evidence of progress from sub-agents: when the operation actually started, completed outputs, concrete blockers. Repeated statements of intent are not progress. If execution stalls or repeated handoffs erase the expected benefit, simplify the assignment or take it back rather than continuing coordination indefinitely.
- Verify the result against the acceptance checks using the smallest independent checks that establish correctness. Reuse evidence already collected; perform expensive checks only when a discrepancy or material uncertainty warrants it.
- Do not claim budget savings without usage evidence.
- Follow explicit user overrides.
