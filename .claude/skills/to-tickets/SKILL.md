---
name: to-tickets
description: Slice .pipeline/<slug>/spec.md into an ordered list of tickets, each small enough for one subagent to implement, test and commit in one sitting. Presents the plan for approval and only then writes tickets.json. Use after /to-spec.
argument-hint: "[slug, defaults to .pipeline/current]"
---

# /to-tickets

You are slicing a spec into tickets for the implement workflow. Each ticket will be handed to a fresh `implement-ticket` subagent with no memory of the others, run in order, one commit each. The slicing decides whether that goes well. The user approves the plan before anything is written.

Slug: $ARGUMENTS (if empty, read `.pipeline/current`)

## 1. Read

`.pipeline/repo.md`, `.pipeline/<slug>/spec.md`, and enough of the affected code to know where the seams are. If the spec still has an unconfirmed inferred decision that affects the slicing, ask about it first, one question at a time.

## 2. Slice

- Green after every ticket. Each ticket leaves the branch with tests, lint and typecheck passing. No ticket depends on a later one to compile.
- Vertical where possible. A thin slice through model, API and UI beats three horizontal layers, because each slice is testable on its own. Foundations (schema, shared types, a module skeleton) come first when several slices need them.
- One sitting. A ticket touches at most about eight files and fits one agent's context. Size S or M. Anything you would call L gets split.
- Tests live in the ticket. The ticket that adds behaviour adds the tests for it. A separate "write tests" ticket is only acceptable for shared fixtures or scaffolding.
- Explicit dependencies. `depends_on` lists ticket IDs. The order must be topological and the graph acyclic.
- Traceable. Every ticket lists the requirements it delivers, and every MUST requirement appears in at least one ticket.
- The last ticket is usually docs, changelog, dead code removal and whatever the spec's Rollout section needs.

## 3. Present the plan

Show a table: ID, title, size, files, requirements, depends on. Under it, one line on the order and why. Ask the user to approve, reorder, merge or split. Wait. Do not write the file until they say yes.

## 4. Write tickets.json

Write `.pipeline/<slug>/tickets.json`:

```json
{
  "slug": "<slug>",
  "spec": ".pipeline/<slug>/spec.md",
  "created": "<date>",
  "tickets": [
    {
      "id": "01",
      "title": "Add export job model and migration",
      "goal": "One sentence a new agent can hold in its head.",
      "requirements": ["R1", "R2"],
      "files": ["src/models/export.py", "migrations/0042_export_job.py", "tests/models/test_export.py"],
      "steps": ["Create ExportJob model with fields ...", "Write migration ...", "Add factory ..."],
      "tests": ["tests/models/test_export.py covers creation, status transitions and the unique constraint"],
      "acceptance": ["ExportJob can be created with status=pending", "Migration applies and reverses cleanly"],
      "depends_on": [],
      "size": "S",
      "notes": "Follow the pattern in src/models/report.py."
    }
  ]
}
```

IDs are zero-padded two-digit strings in execution order. `files` are the files you expect to change; the agent may touch others but will have to say why. `steps` are the plan, not the code.

## 5. Finish

Reply with the ticket count and the order, then: "Run /implement to start the branch." Mention that `/implement` is resumable, so a blocked ticket does not lose the ones already done.
