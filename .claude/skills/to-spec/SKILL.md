---
name: to-spec
description: Turn .pipeline/<slug>/brief.md into spec.md, a checkable spec with numbered requirements and acceptance criteria. Implementing agents build to it without asking questions, and /spec-review grades the finished branch against it. Use after /refine.
argument-hint: "[slug, defaults to .pipeline/current]"
effort: high
---

# /to-spec

You are writing the contract for a feature. Two readers depend on it. The `implement-ticket` agents will build to it without being able to ask you anything, and `/spec-review` will grade the finished branch against it. So every requirement must be observable and every design decision must be made here, not deferred.

Slug: $ARGUMENTS (if empty, read `.pipeline/current`)

## 1. Read

`.pipeline/repo.md`, `.pipeline/<slug>/brief.md`, and the files named under Affected areas. If the brief still has an open question that changes the design, ask it now, one at a time, before writing. Do not write a spec around an unknown.

## 2. Write the spec

Write `.pipeline/<slug>/spec.md`. Rules:

- Every requirement has an ID (`R1`, `R2`, ...), uses MUST or SHOULD, and has at least one acceptance criterion that a test or a person could check. "Fast" is not a criterion. "p95 under 300ms for 10k rows" is.
- Do not invent requirements the brief does not support. Where you had to infer something, mark it `(inferred)` and list every inference at the end for the user to confirm.
- Name real paths. "Add a service" is useless. `src/services/export.py` next to `src/services/report.py`, following the same pattern, is useful.
- Interfaces get shapes: request and response bodies, function signatures, component props, event names, columns with types and nullability.
- Frontend work specifies every state (loading, empty, error, success) and the keyboard and screen reader behaviour.
- Web work specifies who may call each endpoint, what input is validated, and what gets logged.
- Say what is out of scope so nobody builds it.

```markdown
# <Title> spec

Slug: <slug> · Brief: brief.md · Written: <date> · Status: draft

## Summary
<three lines>

## Scope
In: ...
Out: ...

## Requirements
### R1 <short name> (MUST)
<statement>
Acceptance:
- [ ] ...
### R2 ...

## Design
### Approach
### Data model
### Interfaces
### UI behaviour (if any)
### Error handling
### Migrations, config, feature flags
### Backwards compatibility

## Testing
<which tests at which layer, which existing suites must stay green, what to run>

## Non-functional
<performance, security, observability, accessibility, i18n, as relevant>

## Rollout
<flag, migration order, docs, anything the deploy needs>

## Risks

## Follow-ups (out of scope)

## Inferred decisions
<every (inferred) item, one per line, for the user to confirm>
```

## 3. Finish

Reply with the requirement list (IDs and names only) and the inferred decisions, and ask the user to confirm or correct the inferences. Then: "Run /to-tickets to slice this into tickets."
