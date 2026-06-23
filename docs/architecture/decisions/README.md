# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for the cell-kn-mvp-ui
project. An ADR captures a single architecturally significant decision: the
context that forced the choice, the option we picked, and the consequences we
accepted along with it.

## When to write one

Write an ADR when a change introduces or changes:

- a cross-cutting concept that downstream code is expected to honor (e.g., a new
  per-node flag every renderer must respect)
- a contract between modules that isn't obvious from reading either side (e.g.,
  a DOM sentinel attribute consumed by tests)
- a deliberate non-decision — something we considered, rejected, and don't want
  to relitigate in three months

Refactors, bug fixes, and self-contained features that don't change a contract
don't need an ADR.

## Format

We follow [Michael Nygård's lightweight
ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
**Status**, **Context**, **Decision**, **Consequences**. ADRs are short —
one to two pages. They describe a single decision; if you find yourself writing
two, split the file.

Each ADR is numbered sequentially (`0001-`, `0002-`, …) with a kebab-case slug
matching its title. Numbers are never reused; ADRs are never deleted. If a
decision is reversed, write a new ADR that supersedes the old one and update
the older ADR's status to `Superseded by 00NN`.

## Status values

| Status | Meaning |
|---|---|
| `Proposed` | Under discussion, not yet adopted |
| `Accepted` | Adopted; reflects current code |
| `Deprecated` | Still in code but discouraged for new work |
| `Superseded by 00NN` | Replaced by a later ADR |

## Index

- [0001 — Stable graph expansion (incremental layout + user pins)](0001-stable-graph-expansion.md)
