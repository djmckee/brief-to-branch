---
name: spec-review
description: Grade a finished branch against .pipeline/<slug>/spec.md, requirement by requirement, with evidence from the diff and the tests. The verdict is passed, diverged or blocked. Writes .pipeline/<slug>/spec-review.md. Last step of the Review stage, runs after /branch-review-verify.
argument-hint: "[slug, defaults to the current branch]"
allowed-tools: Bash(git:*)
effort: high
---

# /spec-review

Code review asked whether the code is good. This asks whether it is the code we agreed to build. The spec is the contract. You grade the branch against it requirement by requirement, and you only say "met" when you can point at the lines and the test that prove it.

Slug: $ARGUMENTS (if empty: the current branch if it is `feature/<slug>`, otherwise `.pipeline/current`)

## 1. Inputs

- `.pipeline/<slug>/spec.md`. Without it the verdict is `blocked` with reason "no spec"; stop.
- `.pipeline/repo.md` for the commands. `tickets.json` and `review.json` for context, if present.
- Base and head as `/branch-review` computed them (review.json has them), otherwise `git merge-base` with the default branch.
- The full diff `git diff <base>...HEAD`, read file by file.

## 2. Run the suite

Run test, lint and typecheck from the repo card. If they cannot run (missing service, broken build), the verdict is `blocked`; record the output and stop. If they run and fail, carry on grading, but the verdict cannot be `passed`.

## 3. Grade each requirement

For every `R#` in the spec record:

- Evidence: the file and line range in the diff that implements it. None found means `not met`.
- Test: the test that exercises the acceptance criteria. Read it. A test that exists but does not assert the criterion does not count. None found means `partially met` at best.
- Grade: `met`, `partially met`, `not met`, or `not verifiable` (needs a manual check; say which).
- For anything short of `met`, one line on the gap.

Also check the Design and Non-functional sections for anything specific enough to verify: a column type, an authorisation check, a log line, a flag name. Then look for the opposite problem, behaviour in the diff that no requirement asked for, and list it under "Beyond the spec". Unrequested behaviour is a divergence too.

If the spec has more than about fifteen requirements, split the grading across a few read-only subagents by requirement group (Agent tool, `subagent_type: "recon"` with `effort: "higher"`, because grading a test against a criterion needs more care than recon's default map-making effort), each returning evidence and a grade for its group, and merge the results. Keep the verdict yourself.

## 4. Verdict

- `passed`: every MUST is `met`, every SHOULD is `met` or explicitly deferred with a reason, nothing beyond the spec, suite green.
- `diverged`: anything else you could determine. For each divergence say which is wrong, the code or the spec, and recommend one fix: change the code (give a ticket-sized description) or change the spec (give the new wording). Sometimes the implementation found a better answer. Say so; it is still a divergence until the spec changes.
- `blocked`: you could not determine it (no spec, the suite will not run, the branch is not the one the spec describes).

## 5. Write and report

Write `.pipeline/<slug>/spec-review.md`:

```markdown
# Spec review: <title>

Verdict: passed | diverged | blocked · Branch: feature/<slug> · Head: <sha> · Reviewed: <date>
Suite: <green | red: summary | did not run: reason>

## Requirements
| ID | Grade | Evidence | Test | Gap |
|---|---|---|---|---|

## Beyond the spec

## Divergences
<one block each: what, whether the code or the spec is at fault, recommendation>

## Manual checks still needed
```

Reply with the verdict line, the table and the divergences. If `diverged` with the code at fault, offer to turn the fixes into tickets with `/to-tickets` and rerun `/implement`. If the spec is at fault, offer to edit spec.md. If `passed`, say the branch is ready for a human reviewer and point at highlights.md.
