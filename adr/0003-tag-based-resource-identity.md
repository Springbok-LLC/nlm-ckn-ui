# ADR 0003: Tag-Based Resource Identity

- **Status:** Proposed
- **Date:** 2026-06-22

## Context

This repository was renamed from `cell-kn` to `nlm-ckn`, and the new name failed
to propagate consistently. Old and new identifiers now coexist across the repo,
CI, and AWS. This ADR addresses **tag-based identity instead of name-based** —
the AWS-native way to stop the physical name from being load-bearing.

The underlying problem is that when identity is coupled to a human-chosen,
parsed name, every divergence between the old and new name becomes a source of
confusion or breakage: ad-hoc queries (`describe-instances --filter name=cell-kn-*`),
cost allocation, and operational tooling all silently key off a string that is
now wrong in some places and right in others.

### Current state in this codebase

The CloudFormation templates already do a meaningful amount of tagging, which
makes this convention largely a matter of finishing and standardizing rather
than starting from scratch:

- **`Project`** is applied via `Value: !Ref ProjectName` (not a hard-coded
  literal) on most resources across `cloudformation/network/vpc.yaml`,
  `cloudformation/shared/shared-resources.yaml`, `cloudformation/bootstrap/bootstrap.yaml`,
  and the `cloudformation/environment/*.yaml` stacks. This is the correct,
  parameter-driven pattern.
- **`ManagedBy`** is applied consistently as `CloudFormation` (54 occurrences).
- **`Environment`** is present on most `environment/` resources.
- **`Owner` is not applied anywhere** (0 occurrences).
- **`Repository` is not applied anywhere** (0 occurrences) — nothing currently
  ties a resource back to the git repo that defines it.
- **Tag coverage is incomplete per resource.** Several templates declare more
  taggable resources than they tag — e.g. `cloudformation/environment/arangodb.yaml`
  has 5 `Tags:` blocks but only 3 carry `Project`/`Environment`, and
  `cloudformation/environment/backend.yaml` has 6 blocks but only 4. So even
  tag-based queries would miss some resources today.
- **The `Project` tag value still resolves to the legacy prefix.** The
  `ProjectName` parameter defaults to `cell-kn` (`cloudformation/environment/main.yaml`),
  and the deployed parameter files (`cloudformation/parameters/dev.json`,
  `stage.json`, `stage-vpc.json`) all pass `ProjectName: cell-kn`. So live
  resources are tagged `Project=cell-kn`, matching their physical names but not
  the new project name.

In short: the tagging *scaffolding* exists and is parameterized correctly, but
it is neither complete nor standardized, and it inherits the same `cell-kn`
value that the physical names carry.

## Decision

Make **tags**, not physical names, the canonical mechanism for identifying,
grouping, querying, and billing resources. Specifically:

1. **Standardize a required tag set** on every taggable resource:
   - `Project` — `!Ref ProjectName` (already the pattern; keep it parameterized).
   - `Environment` — `dev` / `stage` / `prod`.
   - `Owner` — owning team or contact (currently missing; add it).
   - `ManagedBy` — `CloudFormation` (already consistent).
   - `Repository` — the source git repo that defines the resource (e.g.
     `nlm-ckn-ui`), so resources can be traced back to the IaC that owns them.
     This is especially useful where resources are shared across repos (e.g. the
     ArangoDB bucket defined here but also consumed by `nlm-ckn-etl`).
2. **Query, group, and allocate cost by tags**, never by parsing the physical
   name. Use the Resource Groups / Tag Editor and cost-allocation tags rather
   than `name=cell-kn-*` filters.
3. **Complete tag coverage.** Audit each `cloudformation/environment/*.yaml`
   stack so every taggable resource carries the full required set, closing the
   gaps noted above.
4. **Retrofit existing resources now.** Unlike auto-generated names (ADR 0002),
   tags can be applied to already-deployed `cell-kn-*` resources without
   replacement. Apply the standard tag set to existing resources rather than
   waiting for a rebuild.
5. **Document the legacy prefix.** Record that `cell-kn-*` is the historical
   physical-name prefix and that the canonical identity is the `Project` tag.
   Once the project name is updated, the `Project` tag value becomes the source
   of truth and the legacy name on existing resources is cosmetic.

The deliberate consequence: once identity lives in tags, the physical name is
cosmetic and name drift stops mattering operationally.

## Consequences

### Positive

- **Drift becomes harmless.** A `cell-kn` vs `nlm-ckn` mismatch in a physical
  name no longer breaks queries, dashboards, or cost reports, because those key
  off tags.
- **Retrofittable today.** Existing `cell-kn-*` resources can be tagged in place
  without replacement — unlike the auto-generated-name approach, this convention
  delivers value immediately on already-deployed infrastructure.
- **AWS-native.** Plays directly into Resource Groups, Tag Editor, cost
  allocation tags, and tag policies / SCPs for enforcement.
- **Mostly already in place.** `Project`/`ManagedBy`/`Environment` tagging
  already exists and is parameterized; this is a completion-and-standardization
  effort, not a greenfield one.

### Negative / trade-offs

- **Partial pay-off when retrofitted.** Tag-based identity pays off fully only
  when adopted *before* resources are created. Retrofitting the existing fleet
  still leaves the legacy `cell-kn` string in physical names and in the current
  `Project` tag value until those are updated; the tag-based discipline must be
  paired with ADRs 0001 and 0002 to fully resolve the drift.
- **Tags are not self-enforcing.** Nothing prevents a new resource from shipping
  untagged or mistagged, as the current coverage gaps demonstrate. This needs
  enforcement (cfn-lint/checkov rules, tag policies, or a CI check) to avoid
  re-accumulating gaps.
- **Discipline shifts, not disappears.** Engineers must reach for tag-based
  queries instead of the muscle-memory `name=...*` filters; tooling and runbooks
  referencing name patterns must be updated.
- **Cost-allocation tags require activation.** Tags only appear in Cost Explorer
  / billing after being activated as cost-allocation tags in the billing
  console — a one-time manual step outside this repo.

## Alternatives considered

- **Name-based identity (status quo).** Continue identifying resources by
  parsing the physical name. Rejected: this is the exact coupling that turned a
  rename into pervasive drift; it does not survive a rename and cannot be made
  to.
- **Auto-generated physical names only (ADR 0002).** Let IaC generate
  unique names and reference logical names / exports. Strong and complementary,
  but it only helps resources created *after* adoption and forces replacement of
  stateful resources to apply. Tag-based identity is the piece that can be
  retrofitted onto the existing `cell-kn-*` fleet today, so the two are adopted
  together rather than as substitutes.
- **Wait for a full rebuild to re-create resources under the new name.**
  Rejected as the primary path: high blast radius (stateful resources such as
  ArangoDB and S3), and it leaves the fleet untagged and unqueryable in the
  interim.

## References

- AWS Tagging Best Practices and Tag Policies / SCPs.
- Related: ADR 0001 (naming source-of-truth) and ADR 0002 (auto-generated
  names) — complementary to this decision.
