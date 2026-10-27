---
name: branch-review-verify
description: Give every open finding in review.json a skeptical verdict with the branch-review-verify workflow (one verify-finding agent per major, security or integration finding; verify-minors and verify-tests in batches of five; a blind second opinion at higher effort whenever a major is rejected), then fix the confirmed findings with the branch-review-repair workflow, one tested commit each. Hands over to /spec-review. Runs after /branch-review.
argument-hint: "[slug, defaults to the current branch] [--no-repair]"
allowed-tools: Bash(git:*)
---

# /branch-review-verify

Review findings are claims. This skill turns claims into verdicts, then verdicts into commits. Two workflows run in sequence: verify (parallel, routed by finding type) and repair (sequential, one file group at a time, gated on a clean worktree). Between them you update review.json and tell the user what was confirmed, so nothing gets repaired that they did not see coming.

Arguments: $ARGUMENTS

## 1. Load

- Slug: the current branch if it is `feature/<slug>`, otherwise `.pipeline/current`.
- Read `.pipeline/<slug>/review.json`. Check its `head` still equals `git rev-parse HEAD`. If the branch has moved, stop and ask for a fresh `/branch-review`, because the line numbers are stale.
- Take the findings whose `status` is `open`.

## 2. Verify

Call the Workflow tool with `scriptPath` set to `.claude/workflows/branch-review-verify.js` and `args`:

```json
{
  "slug": "<slug>", "base": "<sha>", "head": "<sha>",
  "findings": [ "...open findings, full objects..." ],
  "reviewPath": ".pipeline/<slug>/review.json",
  "specPath": ".pipeline/<slug>/spec.md",
  "repoCardPath": ".pipeline/repo.md",
  "batchSize": 5
}
```

Routing inside the workflow:

- `major`, `security` and `integration` findings each get one `verify-finding` agent, told to refute the finding and to default to rejected when it cannot demonstrate the problem.
- `minor` findings go to `verify-minors` in batches of five.
- `test-gap` findings go to `verify-tests` in batches of five.
- A rejected `major`, `security` or `integration` finding gets a blind second opinion: a fresh `verify-finding` agent at `xhigh` effort that sees the finding but not the first verdict. If both reject, the finding is rejected. If the second confirms, the finding is `disputed`, excluded from repair and shown to the user.

Wait for the completion notification.

## 3. Record the verdicts

For each open finding, set `status` to `confirmed`, `rejected`, `disputed` or `unverified` (no verdict came back for it) and add `verdict: { reason, confidence, fix, reproduction, secondOpinion, revisedType }`. If a verdict carries `revisedType`, update the finding's `type` and note the original. Write review.json. Reply with a table: ID, type, file, verdict, one-line reason. Disputed and unverified findings get their own short list saying what the verifiers disagreed on.

If the user passed `--no-repair`, stop here and say that rerunning `/branch-review-verify` without the flag will run the repair; confirmed findings are not verified twice.

## 4. Repair

Preconditions: `git status --porcelain` is empty and HEAD still equals `review.json.head`. If not, stop and say why.

Collect the findings whose `status` is `confirmed` and which have no `fix.commit` yet. Call the Workflow tool with `scriptPath` set to `.claude/workflows/branch-review-repair.js` and `args`:

```json
{
  "slug": "<slug>", "branch": "feature/<slug>", "head": "<sha>",
  "findings": [ "...confirmed findings with their verdicts..." ],
  "reviewPath": ".pipeline/<slug>/review.json",
  "specPath": ".pipeline/<slug>/spec.md",
  "repoCardPath": ".pipeline/repo.md"
}
```

The script groups findings by the set of files they touch and runs one `branch-review-repair` agent per group, strictly in sequence. Each agent checks the worktree is clean before it starts, re-reads the current code because an earlier group may have moved lines, makes one tested commit per finding, and records the commit in review.json. An agent that finds a dirty worktree does nothing and the workflow stops. Wait for the completion notification.

## 5. Reconcile and hand over

Reread review.json and `git log --oneline <head>..HEAD`. Every confirmed finding should now be `fixed` with a commit or `skipped` with a reason. Run the full test suite and lint once yourself. Reply with the fixed count, the skipped list with reasons, the disputed list and the new HEAD. Then invoke the `/spec-review` skill. If the suite is red, say so and do not hand over.
