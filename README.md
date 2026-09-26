# leanish-skills

Personal agent skills, installable into your coding agents (Claude Code, Codex, …) with the
[`skills`](https://github.com/vercel-labs/skills) CLI.

## Install

Run from the project where you want the skills (add `-g` to install them for your user instead):

```sh
npx skills@latest add leanish/leanish-skills
```

Pick the skills and target agents when prompted. Some skills target a single agent (see below); to
install one skill for one agent:

```sh
npx skills@latest add leanish/leanish-skills --skill chatz-consensus -a claude-code
npx skills@latest add leanish/leanish-skills --skill frugality -a codex
```

Each skill is then invoked using your agent's own convention — e.g. `/chatz-consensus` in Claude
Code, `$frugality` in Codex.

## Layout

Skills live under `skills/<category>/<name>/SKILL.md`. Two categories:

### `wip/` — leanish's own, work-in-progress

Our first-party skills, still being shaped. New leanish skills land here too.

- [chatz-consensus](./skills/wip/chatz-consensus/SKILL.md) — debate findings and changes with Codex ("Chatz")
  until both agents settle. Claude Code only: it calls Codex through its wrapper, so it needs
  Node.js and a working Codex CLI.
- [frugality](./skills/wip/frugality/SKILL.md) — keep execution cost low: batch work, delegate to
  Luna only when that is cheaper overall, and verify with the smallest sufficient checks. Codex
  only: it delegates to Codex sub-agents running Luna.

### `third-party/` — vendored / external (not leanish-authored)

- [grill-me](./skills/third-party/grill-me/SKILL.md) — one-question-at-a-time grilling of a plan.
- [grill-with-docs](./skills/third-party/grill-with-docs/SKILL.md) — grill a plan against repo
  language; capture terminology / ADRs.
- [improve-codebase-architecture](./skills/third-party/improve-codebase-architecture/SKILL.md) —
  find architectural "deepening" opportunities.
- [karpathy-guidelines](./skills/third-party/karpathy-guidelines/SKILL.md) — LLM coding guardrails,
  derived from Andrej Karpathy's observations (MIT).

These are vendored from external repos ([mattpocock/skills](https://github.com/mattpocock/skills) and
[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)), both MIT.
Full attribution, copyright notices, and license text are in
[skills/third-party/NOTICES.md](./skills/third-party/NOTICES.md); see also
[skills/third-party/README.md](./skills/third-party/README.md). Each skill directory is standalone
(its own `SKILL.md`) and can also be installed individually.
