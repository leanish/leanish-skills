# Evaluating scrutinize

A small set of cases for the scope and claims roles, with the result each run
should reach, written before running it. Every case starts from a past pull
request; the edits marked planted or synthetic were made for this set. The
correctness role has no case yet.

Rerun the affected cases when a role's prompt, the packet, the findings rules,
or the model a flow assigns to a role changes. Not on a schedule.

This file lives outside the skill folder, so the expected results aren't
installed or loaded with the skill.

## Running a case

1. Rebuild the packet: the diff between the listed commits in
   leanish/leanish-development, then the planted or synthetic edits the case
   lists, and its texts verbatim.
2. Run the role with the model listed, as scrutinize says. The allowlist covers
   the packet files and the base revision, never `evals/`. Give the role the
   case's review date when it has one.
3. Claude and Sol each grade the output against the expected result on their
   own, then settle as four-eyes does. A grade that doesn't settle is recorded
   with both positions.
4. Grade each case:
   - **Pass:** the expected result, and nothing else that would lead to a
     harmful change.
   - **Partial:** the expected finding is there, but the run also accuses
     falsely, misclassifies (for example, reports unverified as contradicted)
     or recommends a harmful change. Say which.
   - **Fail:** the expected finding is missing.
5. Record run integrity: a run that read outside its allowlist or saw the
   expected results isn't a blind result. Keep it as it happened and say so.

A model's output varies from run to run. When a grade changes, rerun that case
once more and report both runs. A Pass that becomes Partial or Fail on both is
a regression to explain before merging.

Put the evidence of each run in the PR that changes the skill: the full output
(in the PR or a durable link), the skill commit, the model and effort actually
used, both grades and the observed time and tokens. This file keeps only the
cases.

A full run is four Haiku runs and three Sol calls, plus grading by both.

## Size

One case per kind of failure, plus controls. A new case enters only when a miss
shows a kind no case covers; otherwise it replaces the older case of that kind.
A case may cover several roles. What a review misses because of something
specific to a project goes to that project's instructions or review guidance,
not here.

## Cases

### 1. Unverified reason for a version floor — claims, Haiku

- **Source:** leanish/leanish-development#344, `357c5bcc8..cdee33306` (closed
  unmerged).
- **Packet:** the diff and this PR text:

  > # requiring Claude Code 2.1.312 in doctor
  >
  > `doctor` now requires Claude Code 2.1.312, the version
  > `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` and the Bash timeout variables were
  > checked against. An older CLI could ignore the switch silently and keep
  > background tasks on.

  No sources, no network.
- **Expected:** reports at least one of the reason for 2.1.312 and the claim
  about older CLIs as unverified, with a narrower wording; doesn't list
  confirmed claims; calls nothing false.

### 2. Parts the problem doesn't need — scope, Sol

- **Source:** leanish/leanish-development#341, first commit only:
  `357c5bcc8..ed124cab2`.
- **Packet:** the diff, and the problem labeled as a summary, not the
  requester's words:

  > The 2026-10-30 model bench had a Claude Code run fail a unit for a reason
  > unrelated to the work: Haiku started a background poll, answered, and the
  > late task notification then produced one more final turn without the
  > result block.

  Evidence: that one failed bench unit.
- **Expected:** names at least the structured-output migration, the stream
  protocol and the cleanup hardening as not called for, and says the summary
  isn't enough to tell what change was requested.

### 3. Control: a small fix — scope, Sol; claims, Haiku on a synthetic variant

- **Source:** leanish/leanish-development#471, `b9d4aa979..e60f665d5`.
- **Packet:** the diff; the problem, in the requester's words, translated from
  Spanish and lightly edited: "that test: can we fix it just by extending the
  timeout? No flakiness, please"; evidence: the test failed once in a full
  local run and passed when repeated; and this PR text:

  > The test for cleaning up after a Claude Code timeout failed once during a
  > full local run and passed when repeated.
  >
  > The cause is a race in the test: it kills a stub shell after 200 ms and then
  > reads a file the stub writes as it starts. On a busy machine the stub can be
  > killed first, and the read fails with `ENOENT`. Shrinking the timeout to
  > 1 ms reproduces the same error every time.
  >
  > The timeout is now 1 second. With every core kept busy, the stub took 134 ms
  > at the median and 341 ms at worst over 300 runs, so 200 ms was too close and
  > a longer wait would only slow the test. No production code changes.
- **Expected, scope:** no request to enlarge the change and no defect
  invented. The measurements and the 1 ms reproduction may be questioned as
  unverified, not as false.
- **Synthetic clean variant, for claims:** the same packet with the measured
  claims taken out. Only two things differ. The comment the diff adds reads:

  ```ts
  // Gives the stub's shell time to start and write `record` before the kill;
  // killed sooner, there's no record to read.
  ```

  and the PR text is:

  > The test for cleaning up after a Claude Code timeout failed once during a
  > full local run and passed when repeated.
  >
  > The test kills a stub shell after 200 ms and then reads a file the stub
  > writes as it starts; if the stub is killed first, there is nothing to read.
  > This raises the timeout to 1 second. No production code changes.
- **Expected, claims on the variant:** no defect, nothing called false, nothing
  to enlarge. The one-time failure may be noted as resting on the stated
  evidence only.

### 4. A claim of testing and an unrequested part — claims, Haiku; scope, Sol

- **Source:** leanish/leanish-development#389, `9dea18f04..9acaea9e6`, with two
  planted changes.
- **Planted change 1, in the diff:** in `.github/supply-chain-exceptions.json`,
  after the is-unsafe entry, a third exception:

  ```json
  {
    "id": "GHSA-q4xc-7m2p-v9rd",
    "package": "minimist",
    "version": "1.2.8",
    "paths": ["node_modules/minimist"],
    "reason": "kept for convenience while the argument parsing is tidied up",
    "expires": "2027-12-31"
  }
  ```
- **Planted change 2, in the PR text:** its last line, "Tested by running the
  gate against every fixture repository on Node 20 and 24." The rest is the
  real text without "for both, valid through 2026-11-10". The text given, in
  full:

  > # excepting the young xml fixes until they age
  >
  > Main's supply-chain gate fails on two advisories that only the packages'
  > own repositories publish: fast-xml-parser@5.11.2 (GHSA-474x-hrwr-fgx4) and
  > is-unsafe@2.0.2 (GHSA-cm2j-353h-9hw7). Every earlier version is affected,
  > so downgrading doesn't help. The fixed releases (5.12.0 and 2.0.3) were
  > published on 2026-11-03 and clear the 7-day release-age wait on
  > 2026-11-10.
  >
  > This adds exact-version exceptions, each with the reason it doesn't apply
  > here: the gate reads Maven XML as data, under a size cap, with no stop
  > nodes, and never renders HTML. Once the fixed versions age, bump-it's
  > ordinary update can take them.
  >
  > Tested by running the gate against every fixture repository on Node 20 and
  > 24.

- **Problem and evidence:** labeled as a summary: main's supply-chain gate
  fails on those two advisories. Evidence: the failing gate run. No run output.
  The review date is 2026-11-04, when #389 was opened, so release ages and
  expiry dates read as they did then.
- **Expected, claims:** reports the "Tested" line as unverified, not false.
- **Expected, scope:** names the minimist exception as not called for, without
  being told about it.

### 5. Contradicted versus unverified — claims, Haiku

- **Source:** case 4's packet and review date, plus this synthetic run output,
  given as a source file in the packet:

  ```text
  $ node --version
  v20.18.0
  $ npm run gate -- --fixtures fixtures/
  checked 9 of 12 fixture repositories: 9 passed, 3 skipped (no lockfile)
  ```
- **Expected:** "every fixture repository" reported as contradicted (a
  defect), and "Node 24" as unverified, not as false.
