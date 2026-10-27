# Ticket-to-review pipeline for Claude Code

A drop-in `.claude/` folder contains working skills, subagents and workflow scripts. Skills handle the conversation. Workflow scripts take over when the work fans out, running subagents in fixed phases, in parallel where that is safe and one at a time where it is not. It is written for web, Python, Node and frontend repositories, and everything stack-specific is read from a repo card that `/setup` generates, so the same skills work across all four.

## What is in the folder

```
.claude/
  skills/                      slash commands, one folder each
    setup/        refine/        to-spec/        to-tickets/
    implement/    highlights/
    branch-review/  branch-review-verify/  spec-review/
  agents/                      subagent definitions (the system prompt is the file body)
    recon.md                   optional, read-only codebase map during planning
    implement-ticket.md        one per ticket, sequential
    branch-review-file.md      one per changed file, parallel
    branch-review-integration.md  one per branch, after every file review
    verify-finding.md          one per major, security or integration finding
    verify-minors.md           batches of five minors
    verify-tests.md            batches of five test gaps
    branch-review-repair.md    one per file group, sequential
  workflows/                   Workflow tool scripts, plain JavaScript
    implement.js               1 phase, sequential, stops on a blocked ticket
    branch-review.js           2 phases, parallel then single
    branch-review-verify.js    1 phase, parallel lanes routed by finding type
    branch-review-repair.js    1 phase, sequential, stops if the worktree is dirty
```

## Install

Copy `.claude/` into the root of a repository (merge it if the repo already has one), then run `/setup` once. To have the commands in every repository instead, copy the three subfolders into `~/.claude/skills/`, `~/.claude/agents/` and `~/.claude/workflows/`. Project copies take precedence over personal ones.

### Model and effort per agent

| Agent | Model | Effort | Why |
|---|---|---|---|
| `implement-ticket` | fable | high, xhigh on the retry | Writes the code that lands. A retry has already failed once. |
| `branch-review-repair` | fable | high | Writes code, one commit per finding. |
| `branch-review-file` | opus | high | Judgment per file: correctness and security. One file each, in parallel, and the verify stage filters what they return. |
| `branch-review-integration` | fable | xhigh | One agent per branch, and the only one that can see a broken caller in a file the branch did not touch. |
| `verify-finding` | fable | high, xhigh for the blind second opinion | A lazy verifier rejects real bugs. |
| `verify-minors` | opus | medium | Batches of low-stakes checks: preference, linter territory, pre-existing. |
| `verify-tests` | opus | medium | Search-heavy: does any test anywhere cover this. |
| `recon` | opus | medium | A map, not a judgment. `/spec-review` asks for one step higher when it reuses recon to grade. |

Every agent names its model, so the pipeline does not depend on which model the session is using. `fable` and `opus` are the Claude Code aliases for the current model of each tier (Fable 5.1 and Opus 5.5 at the time of writing), so the folder stays current without pinning a version. Fable goes where the output lands directly or decides what lands: the implementers, the integration review and the verifier that gates repairs. Opus goes where the scope is one file or one batch and another agent checks the result. Effort is pinned on the agents so an `/effort low` session does not quietly weaken the implementers and reviewers. `/to-spec` and `/spec-review` pin `effort: high` for the same reason: they write and grade the contract. The other skills run inline at the session level on purpose, because a skill-level effort also becomes the level that workflow agents without their own setting would inherit.

`tests/workflow-harness.mjs` runs the four scripts against stubbed agents (retry, blocked ticket, disputed verdict, dirty worktree) and needs only Node: `node tests/workflow-harness.mjs .claude/workflows /tmp/wf-harness`.

The scripts need a Claude Code build with the Workflow tool. The workflow files are named `*-workflow` inside their `meta` block on purpose: `.claude/workflows/` scripts also appear as slash commands, and a script called `implement` would collide with the `/implement` skill. The skills launch the scripts by path, so you never type the workflow names yourself.

## The flow

You type two commands after planning. Everything else chains.

### Plan: a conversation, no workflow

| Command | What it does | Writes |
|---|---|---|
| `/setup` | Detects the stack, finds the test, lint, typecheck and build commands and runs them once, maps the layout, records conventions. Once per repo. | `.pipeline/repo.md` |
| `/refine <ask>` | Fetches the ticket if it can, optionally sends `recon` to read the code, then asks one question at a time, each with a recommended default. | `.pipeline/<slug>/brief.md` |
| `/to-spec` | Numbered requirements with acceptance criteria, real paths, interface shapes, every UI state. Inferred decisions are listed for you to confirm. | `.pipeline/<slug>/spec.md` |
| `/to-tickets` | Slices the spec into tickets that each leave the branch green, shows you the plan, waits for approval. | `.pipeline/<slug>/tickets.json` |

### Deliver: you run `/implement`

`/implement` checks the preconditions (tickets exist, `.pipeline/` is ignored, worktree clean), creates `feature/<slug>`, writes `state.json`, and launches `implement.js`. The script runs one `implement-ticket` agent per ticket, strictly in order. Each agent reads the repo card, the spec and its ticket, implements, writes tests, runs the suite, lint and typecheck, goes through a self-check, makes exactly one commit and marks itself done in `state.json`. A blocked ticket is retried once at xhigh effort with the blocker's reason, then the script stops, because later tickets may depend on it. Rerun `/implement` and it carries on from the first unfinished ticket.

When every ticket is done, Claude invokes `/highlights`, which writes an MR-ready summary and, with your approval, tidies the commit history.

### Review: you run `/branch-review`

`/branch-review` scopes the diff against the default branch, classifies every file (and lists what it skipped), and launches `branch-review.js`:

1. File review, parallel. One `branch-review-file` agent per changed file, each with a clean context. Each returns findings with line-level evidence plus a contract summary: what the file now exports, expects and assumes.
2. Integration review, single. Waits for every file review, then one `branch-review-integration` agent checks the contracts between files: changed signatures against call sites, models against migrations, API against client, props against usage.

A file agent that fails is retried once. If it still fails, nothing partial is published. Otherwise the skill dedupes the findings, assigns IDs and writes `review.json`, then invokes `/branch-review-verify`, which launches two more scripts:

3. `branch-review-verify.js`, parallel, routed by type. Major, security and integration findings get one `verify-finding` agent each, told to refute the finding and to reject it if it cannot demonstrate the problem. Minors and test gaps go in batches of five. If a serious finding is rejected, a blind second opinion runs at `xhigh` effort without seeing the first verdict. Both reject and it is rejected. They disagree and it is marked disputed, left out of the repair and shown to you.
4. `branch-review-repair.js`, sequential. Confirmed findings are grouped by the files they touch and handed to one `branch-review-repair` agent per group, one after another. Each agent checks the worktree is clean, locates the code by content (earlier groups may have moved lines), makes one tested commit per finding and records it in `review.json`. A dirty worktree stops the run.

Finally Claude invokes `/spec-review`, which grades the branch against the spec requirement by requirement, with the diff lines and the test that prove each one, and gives a verdict of passed, diverged or blocked.

## The file contract

Everything lives under `.pipeline/`, which `/setup` adds to `.gitignore` so it never enters a commit or a review diff.

| File | Written by | Read by |
|---|---|---|
| `repo.md` | `/setup` | every skill and every agent |
| `current` | `/refine` | any skill run without a slug |
| `<slug>/brief.md` | `/refine` | `/to-spec` |
| `<slug>/spec.md` | `/to-spec` | `/to-tickets`, `implement-ticket`, reviewers, `/spec-review` |
| `<slug>/tickets.json` | `/to-tickets` | `/implement`, `/highlights` |
| `<slug>/state.json` | `/implement`, `implement-ticket` | `/implement` on resume, `/highlights` |
| `<slug>/highlights.md` | `/highlights` | you, the MR description |
| `<slug>/review.json` | `/branch-review`, then verify and repair | `/branch-review-verify`, `/spec-review` |
| `<slug>/spec-review.md` | `/spec-review` | you |

The slug is `feature/<slug>` without the prefix. Every skill after `/refine` resolves it from an argument first, then from the branch name, then from `.pipeline/current`.

## Where the design choices live

Fan out where it is safe. Reviewing twenty files means twenty reviewers at once, each with one file. That is the `parallel()` call in `branch-review.js`.

Gates between phases. The integration review waits for every file review, which is the one place a barrier is deliberate. The verify script uses `pipeline()` instead, so a rejected major moves to its second opinion without waiting for the others.

Sequential where it matters. Tickets and repairs touch shared code, so `implement.js` and `branch-review-repair.js` are plain `for` loops with one agent at a time, one commit each and a clean worktree check in the agent's preconditions.

Resumable. `state.json` and `review.json` hold progress on disk. Rerunning the command picks up where it stopped, and within a session the Workflow tool's `resumeFromRunId` reuses agents that already finished.

## Demo order for a talk

1. `/setup` on a small repo. Show `repo.md`.
2. `/refine <a real ticket>`. Show the one-question-at-a-time exchange and `brief.md`.
3. `/to-spec`, then `/to-tickets`. Show the approval table.
4. `/implement`. Open `/workflows` to show the sequential agents, then `git log`.
5. `/branch-review`. Open `/workflows` again to show the parallel fan-out and the integration gate, then the verdict table and the repair commits.
6. End on `spec-review.md`.

Each skill file is short enough to put on a slide, and each agent file is the whole system prompt for that subagent, so the talk can show exactly what each box in the diagram is told to do.
