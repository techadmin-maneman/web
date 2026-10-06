# 0001. Record architecture decisions

- Status: accepted
- Date: 2026-09-21
- Topic: Platform

## Context

The build prompt asks that every ambiguity be written down with the assumption taken, and that every departure from the prompt or from the AILabTools reference harness be justified.

## Decision

Each decision is a numbered file in `docs/decisions/`, `NNNN-kebab-title.md`, with a status, a date, the context, the decision and its consequences. A decision is never edited to say something else; a later ADR supersedes it and both link to each other.

Code may cite an ADR. The linter accepts a `@ts-ignore` or `@ts-expect-error` only with a description of the form `: see docs/decisions/NNNN-….md`, and a destructive migration only with a `-- contract: docs/decisions/NNNN-….md` annotation naming an ADR that exists.

## Consequences

Reviewers can find why something is the way it is without reading the whole history.
