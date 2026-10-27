---
name: highlights
description: Summarise a finished feature branch for a reviewer: what changed and why, how to test it, where to look closely, and the commit list. Writes .pipeline/<slug>/highlights.md, which doubles as the MR description. Offers to reshape commits (squash fixups, split mixed commits) and only does so with approval. Runs after /implement.
argument-hint: "[slug, defaults to the current branch]"
allowed-tools: Bash(git:*)
---

# /highlights

The branch is built. Now make it easy to review. You produce a reviewer-facing summary and, if the history would benefit, a proposal to reshape the commits. Write the summary for a colleague who has not read the spec.

Slug: $ARGUMENTS (if empty: the current branch if it is `feature/<slug>`, otherwise `.pipeline/current`)

## 1. Read the branch

- Base: `git merge-base <default branch> HEAD`, with the default branch from the repo card.
- `git log --format='%h %s%n%b' <base>..HEAD` and `git diff --stat <base>..HEAD`.
- `.pipeline/<slug>/spec.md`, `tickets.json` and `state.json`, so you can relate commits to tickets and tickets to requirements.
- The diff of anything surprising: a file no ticket listed, a large deletion, a config or dependency change, a migration.

## 2. Write highlights.md

Write `.pipeline/<slug>/highlights.md`:

```markdown
# <Title>

<One paragraph: the problem and what this branch does about it. Plain statements, no "this MR".>

## What changed
<Grouped by area, not by commit. Each bullet gives the change and the reason, with the requirement IDs it delivers.>

## How to test it
<Numbered steps a reviewer can follow locally, with the exact commands from the repo card and any seed data or env vars needed.>

## Where to look closely
<The two or three places where a reviewer's attention is best spent: tricky logic, security-relevant code, a migration, a public interface change.>

## Not in this branch
<Follow-ups, out-of-scope items, anything the spec deferred.>

## Screenshots or recordings needed
<For UI work, which states to capture. Otherwise "none".>

## Commits
<hash, subject, ticket ID, one per line>
```

Keep the file under 80 lines. Keep the headings as given so MR templates and reviewers get the same shape every time.

## 3. Consider reshaping the history

Look for fixup-style commits ("fix tests", "lint"), a commit that mixes two tickets, a message that no longer describes its commit, and debug leftovers committed then removed. If the history is already one clean commit per ticket, say so and skip this section.

Otherwise propose the reshape as a before and after list and ask the user. Only on approval, do it non-interactively, since interactive rebase is not available: `git reset --soft <base>` and recommit in the proposed groups, or `git rebase` with `GIT_SEQUENCE_EDITOR` driving a scripted todo list. Never rewrite a branch that others have already reviewed without saying so first. After reshaping, run the suite and lint again and confirm `git diff <old head>` is empty.

## 4. Finish

Reply with the summary paragraph and the "Where to look closely" section, and give the file path. If the user wants an MR or PR opened, use highlights.md as the description with `glab mr create` or `gh pr create`; do not open one unasked. Suggest `/branch-review` as the next step.
