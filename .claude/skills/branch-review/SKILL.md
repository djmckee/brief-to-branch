---
name: branch-review
description: Review a feature branch with the branch-review workflow. Scopes the diff against the default branch, classifies every changed file, runs one branch-review-file subagent per file in parallel, then one branch-review-integration subagent over all of them. Dedupes the findings, publishes .pipeline/<slug>/review.json and hands over to /branch-review-verify.
argument-hint: "[base ref, defaults to the merge-base with the default branch]"
disable-model-invocation: true
allowed-tools: Bash(git:*)
---

# /branch-review

You run the Review stage. Subagents do the reviewing, each with a clean context: one per changed file, then one that sees every file review and checks the contracts between files. Your job is scoping, classification, launching the workflow, deduplication and publishing review.json. You do not review code yourself here.

Base override: $ARGUMENTS

## 1. Scope the diff

- Slug: the current branch if it is `feature/<slug>`, otherwise `.pipeline/current`. The branch need not have come from `/implement`. Any branch can be reviewed, in which case the spec and tickets may be absent, and that is fine.
- Base: the argument if given, otherwise `git merge-base origin/<default> HEAD`, with the default branch from `.pipeline/repo.md` or `git symbolic-ref refs/remotes/origin/HEAD`. Head is `HEAD`. Record both SHAs.
- Refuse to continue if `git status --porcelain` shows anything. Uncommitted changes would make every line number wrong.
- `git diff --name-status <base>...HEAD` for the file list and `git diff --numstat <base>...HEAD` for sizes.

## 2. Classify every file

Give each file a `kind`: `source`, `test`, `config`, `migration`, `docs`, `generated`, `asset` or `lockfile`. Use the repo card's "Generated or skip in review" globs plus the obvious (`*.lock`, `package-lock.json`, `*.min.js`, `*.snap`, `*.generated.*`, `dist/`, binaries). Give each a `language` from its extension.

Review `source`, `test`, `config` and `migration`. Skip `generated`, `asset` and `lockfile`. Deleted files go to the integration agent only, since their callers matter but there is nothing in them to review. Review docs only when the branch is mostly docs. List every skipped file with the reason. Nothing is dropped silently.

If more than 60 files remain, say so and ask whether to proceed or narrow the base. The parallel phase will cope, but the integration agent's input grows with every file.

## 3. Launch the workflow

Call the Workflow tool with `scriptPath` set to `.claude/workflows/branch-review.js` and `args` as a JSON object:

```json
{
  "slug": "<slug>",
  "base": "<base sha>",
  "head": "<head sha>",
  "files": [
    { "path": "src/api/export.py", "status": "M", "kind": "source", "language": "python", "added": 120, "deleted": 8 }
  ],
  "deleted": ["src/old/thing.py"],
  "skipped": [ { "path": "pnpm-lock.yaml", "reason": "lockfile" } ],
  "specPath": ".pipeline/<slug>/spec.md",
  "ticketsPath": ".pipeline/<slug>/tickets.json",
  "repoCardPath": ".pipeline/repo.md"
}
```

Leave out `specPath` and `ticketsPath` if those files do not exist. Phase one reviews every file in parallel. Phase two waits for all of them, then one integration agent reads every file's findings and contract summary. An agent that returns nothing is retried once; if it still fails, the workflow returns a `blocked` list and you must not publish a partial review. Wait for the completion notification.

## 4. Dedupe and publish

If `blocked` is non-empty: report it, do not write review.json, and tell the user to rerun `/branch-review`. Within the same session the Workflow tool's `resumeFromRunId` reuses the reviews that succeeded.

Otherwise merge the file findings and the integration findings:

- Two findings are duplicates when they name the same file, their line ranges overlap or touch, and they describe the same root cause. Keep the one with the higher severity and the better evidence, and append the other's detail. The integration agent lists file-level findings it `supersedes`; drop those.
- Assign IDs `F001`, `F002`, ... ordered by type (`security`, `major`, `integration`, `minor`, `test-gap`) then by file.
- Drop findings with no `evidence` or no line number, unless they are integration findings about a change that is missing.

Write `.pipeline/<slug>/review.json`:

```json
{
  "slug": "<slug>", "base": "<sha>", "head": "<sha>", "reviewed": "<date>",
  "files": [ "...the reviewed list..." ], "skipped": [ "..." ],
  "contracts": [ "...each file agent's contract summary..." ],
  "missingChanges": [ "...from the integration agent..." ],
  "findings": [
    {
      "id": "F001", "type": "major", "file": "src/api/export.py", "line": 42, "endLine": 48,
      "category": "error-handling", "summary": "Export job is marked complete before the upload finishes",
      "detail": "...", "evidence": "line 44 sets status=done; the await on line 47 can still raise",
      "suggestedFix": "...", "confidence": "high", "source": "file", "status": "open"
    }
  ]
}
```

`type` is one of `major`, `security`, `integration`, `minor`, `test-gap`. `/branch-review-verify` routes on it.

## 5. Report and hand over

Reply with a count per type, the top five findings in one line each, the skipped files and the path. Then, if there are open findings, invoke the `/branch-review-verify` skill. If there are none, say so plainly and invoke `/spec-review`.
