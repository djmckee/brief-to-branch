---
name: implement
description: Create feature/<slug> and run the implement workflow, which hands each ticket in tickets.json to an implement-ticket subagent in order, one tested commit per ticket. Progress lives in state.json, the run stops at the first blocked ticket, and rerunning resumes from where it stopped. Hands over to /highlights when every ticket is done.
argument-hint: "[slug, defaults to the current branch or .pipeline/current]"
disable-model-invocation: true
allowed-tools: Bash(git:*)
---

# /implement

You run the Deliver stage. You do not write feature code yourself here. The implement workflow does that, through one `implement-ticket` subagent per ticket. Your job is the preconditions, the branch, the state file, launching the workflow, and an honest report afterwards.

Slug: $ARGUMENTS (if empty: the current branch if it is `feature/<slug>`, otherwise `.pipeline/current`)

## 1. Preconditions, all of them, before touching anything

Stop and tell the user which one failed if any of these is false:

- `.pipeline/<slug>/tickets.json` exists and parses. `.pipeline/<slug>/spec.md` and `.pipeline/repo.md` exist.
- `git check-ignore -q .pipeline` succeeds. If not, the state file would end up in a commit. Tell the user to run `/setup` or add `.pipeline/` to `.gitignore`.
- The worktree is clean: `git status --porcelain` prints nothing. Do not stash or discard anything on the user's behalf.
- You are on the default branch or already on `feature/<slug>`. On any other branch, ask.
- On a first run, the default branch is up to date with its remote, or the user has said they do not mind.

## 2. Branch

If `feature/<slug>` exists, check it out. Otherwise create it from the current HEAD with `git switch -c feature/<slug>`.

## 3. State file

If `.pipeline/<slug>/state.json` does not exist, create it with one entry per ticket, in order:

```json
{
  "slug": "<slug>",
  "branch": "feature/<slug>",
  "base": "<sha the branch started from>",
  "started": "<date>",
  "tickets": {
    "01": { "status": "pending", "commit": null, "attempts": 0, "notes": null }
  }
}
```

Statuses are `pending`, `done` and `blocked`. If the file already exists this is a resume: read it, reconcile against `git log` (a ticket whose commit is on the branch is `done`), and tell the user what is already done and what will run.

## 4. Launch the workflow

Build the list of tickets to run: every ticket whose status is `pending` or `blocked`, in tickets.json order, as full ticket objects. Call the Workflow tool with `scriptPath` set to `.claude/workflows/implement.js` and `args` as a JSON object (not a string):

```json
{
  "slug": "<slug>",
  "branch": "feature/<slug>",
  "repoCardPath": ".pipeline/repo.md",
  "specPath": ".pipeline/<slug>/spec.md",
  "statePath": ".pipeline/<slug>/state.json",
  "tickets": [ "...full ticket objects..." ],
  "maxAttempts": 2
}
```

The workflow runs tickets strictly one at a time. Each agent implements, tests, self-checks, makes exactly one commit and updates its own entry in state.json. A blocked ticket is retried once at xhigh effort with the blocker's reason, then the workflow stops, because later tickets may depend on it. Wait for the completion notification rather than polling.

## 5. Reconcile and report

When the workflow returns, reread state.json and `git log --oneline <base>..HEAD`. Fix any mismatch in state.json; the git log is the truth. Report a table: ticket, status, commit, one-line summary. Then:

- Every ticket done: run the full test suite and lint once more yourself, using the repo card. If green, invoke the `/highlights` skill. If not, say what failed and do not hand over a red branch.
- A ticket blocked: show the blocker's reason and the stash the agent left (`blocked <slug> <id>`). Offer the options in one line: fix it by hand and rerun `/implement`, edit the ticket in tickets.json and rerun, or split it with `/to-tickets`. Stop there.
- Workflow interrupted: say so. state.json holds the progress, and rerunning `/implement` continues from the first unfinished ticket.
