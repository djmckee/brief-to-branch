---
name: refine
description: Turn a vague ask (a ticket key, a sentence, a pasted brief) into a shared understanding before any spec is written. Asks one question at a time, each with a recommended default, optionally sends the recon subagent to read the codebase, and writes .pipeline/<slug>/brief.md. Use at the start of any feature or sizeable change.
argument-hint: "<ticket key, sentence, or path to a brief>"
---

# /refine

You are refining an ask into a brief. Planning is a conversation with the user, so the pace is theirs. The rule that matters most: ask one question at a time. Never bundle questions. Never ask something the code or the repo card can answer.

The ask: $ARGUMENTS

## 1. Gather what you can without asking

- Read `.pipeline/repo.md`. If it is missing, say so in one line, suggest `/setup`, and carry on with what you can see.
- If the ask looks like a ticket key (`ABC-123`) or an issue URL and you have a tool that can fetch it, fetch it and read the description, acceptance criteria and comments. If the ask is a file path, read the file.
- Decide whether to send `recon`. Send it when the change touches existing code you have not read in this conversation; skip it for greenfield work. Launch it with the Agent tool using `subagent_type: "recon"`, pass it the ask and the repo card path, and ask for the files involved and their roles, the existing patterns to copy with one example each, entry points, data models, the tests already covering the area, risks, and the questions the code cannot answer. One recon agent, not several.

## 2. Form a draft understanding privately

Write down for yourself the problem, who it is for, goals, non-goals, constraints (technical, time, compatibility) and the unknowns. Rank the unknowns by how much the answer would change the design. Most of them resolve into a sensible default. Only the ones that would change the shape of the work become questions.

## 3. Ask, one question at a time

Each question message is short:

- The question, in one sentence.
- Why it matters, in one sentence.
- A recommended answer, so the user can reply "yes".

Wait for the answer before asking the next question, and adjust the remaining questions in light of it. Stop when the remaining unknowns would not change the spec, or after about six questions. Anything still open becomes a stated assumption rather than another question.

Worth asking when the ask does not say: who uses the feature, the expected volume, what happens on failure, backwards compatibility, whether it needs a feature flag, where the edge of scope is, and whether a UI change has a design to follow.

## 4. Choose the slug

Derive a slug: kebab-case, at most 40 characters, prefixed with the ticket key if there was one (`tfi-412-bulk-export`). State it in your first reply. It is not a question.

## 5. Write the brief

Write `.pipeline/<slug>/brief.md`, and write the slug on its own line to `.pipeline/current`.

```markdown
# <Title>

Ticket: <key or none> · Slug: <slug> · Refined: <date>

## Problem
## Who it is for
## Goals
## Non-goals
## Constraints
## Decisions
<one line per question asked: the question, the answer>
## Assumptions
<what you decided without asking, and why>
## Affected areas
<from recon: files, modules, entry points, existing patterns to follow>
## Risks
## Source
<the original ask, verbatim>
```

## 6. Finish

Reply with the goals, non-goals and assumptions in five to eight lines, then: "Run /to-spec when you're happy with this."
