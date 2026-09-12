---
name: frugality
description: Plan and verify work using the full capabilities of the selected model, while delegating implementation, research, and routine execution to a technically knowledgeable sub-agent (Luna).
---

# Frugality

- The main agent creates an actionable plan covering scope, constraints, relevant inputs, expected outputs, and acceptance checks. Reserve its reasoning for ambiguity, tradeoffs, and decisions where it materially helps.
- Delegate implementation, research, and routine execution to `gpt-5.6-luna` with effort `max` (or its highest available effort) and `fork_turns=none`. Provide the plan and minimum sufficient context.
- Reuse an existing Luna sub-agent whenever possible; verify its availability before attempting to resume it. Create one when none is available.
- Wait for completion or meaningful updates without frequent polling or duplicate exploration. Request a concise result with evidence, changed artifacts, checks, and unresolved issues.
- The main agent independently verifies the result against the acceptance checks. Return necessary corrections to the same sub-agent until they are satisfied.
- Follow explicit user overrides. If the requested model or delegation is unavailable, disclose the limitation and use an available fallback.
