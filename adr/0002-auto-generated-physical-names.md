# ADR 0002: Auto-Generated Physical Names for Stateful Resources

- **Status:** Proposed
- **Date:** 2026-06-22

## Context

This repository (`nlm-ckn-ui`) was renamed from `cell-kn` to `nlm-ckn`, and the
new name failed to propagate cleanly. The result is a mix of old and new
identifiers across the repo, CI, and AWS. This ADR records the decision to *let
IaC auto-generate physical names and avoid explicit names on stateful
resources.*

A significant part of why the rename is painful is that the project name is
baked into the **physical names** of stateful AWS resources, and several of
those physical names are immutable — changing them forces CloudFormation to
**replace** the resource (data loss, downtime, ARN churn). Our CloudFormation
templates currently set explicit physical names derived from `ProjectName` on
exactly the resources where this hurts most:

- `cloudformation/shared/shared-resources.yaml`
  - `RepositoryName: !Sub '${ProjectName}-backend'` (ECR repository)
  - `BucketName: !Sub '${ProjectName}-arangodb-data-${AWS::AccountId}'` (S3)
- `cloudformation/environment/frontend.yaml`
  - `BucketName: !Sub '${ProjectName}-${Environment}-frontend'` (S3)
- `cloudformation/environment/alb.yaml`
  - `BucketName: !Sub '${ProjectName}-${Environment}-alb-logs-${AWS::AccountId}'` (S3)
- `cloudformation/environment/backend.yaml`
  - `RoleName: !Sub '${ProjectName}-${Environment}-backend-exec'`
  - `RoleName: !Sub '${ProjectName}-${Environment}-backend-task'`
- `cloudformation/environment/arangodb.yaml`
  - `RoleName: !Sub '${ProjectName}-${Environment}-arangodb-ec2'`
- `cloudformation/environment/monitoring.yaml`
  - `RoleName: !Sub '${ProjectName}-${Environment}-monitoring-scraper'`
  - `RoleName: !Sub '${ProjectName}-${Environment}-monitoring-wedge'`
- `cloudformation/environment/ecs-cluster.yaml`
  - `ClusterName: !Sub '${ProjectName}-${Environment}-cluster'`

Each of these couples resource identity to a human-chosen name. A rename of
`ProjectName` therefore implies replacing buckets, the ECR repository, IAM
roles, and the ECS cluster — not just relabeling them.

## Decision

Do **not** set explicit physical names (`BucketName`, `RoleName`,
`RepositoryName`, `ClusterName`, `FunctionName`, `QueueName`, `TableName`,
etc.) on **new** resources unless a stable cross-stack reference genuinely
requires a known, fixed name.

When the physical name is omitted, CloudFormation generates a unique physical
name automatically. Within a template, reference the resource by its **logical**
name (`!Ref`, `!GetAtt`) rather than by a reconstructed physical name. For
**cross-stack** references, use stack outputs / exports (`!ImportValue`) or SSM
Parameter Store lookups — never a hard-coded physical name.

Concretely:

- New stateful resources (S3 buckets, ECR repositories, IAM roles, ECS
  clusters, DynamoDB tables, SQS queues) omit their `*Name` property.
- Cross-stack consumers import the auto-generated name via the producing
  stack's `Outputs`/`Export` (the templates already export, e.g.,
  `EcrRepositoryName`, `ArangoDbS3BucketName`, `ClusterName`) or via SSM,
  rather than re-deriving `${ProjectName}-...`.
- Where a fixed name is unavoidable (e.g., a name contract consumed by an
  external system), document *why* in the template and treat it as a deliberate
  exception.

This convention pays off **only when adopted before a resource is first
created**. We do not rename existing `cell-kn-*` resources as part of this
decision (see Consequences); the rule applies to every new resource going
forward.

## Consequences

### Positive

- **Renames stop forcing replacement.** With no explicit name, changing
  `ProjectName` (or the project name itself) does not alter a stateful
  resource's physical identity, so no replacement, no data loss, no ARN churn.
- **Drift becomes harmless for new resources.** The literal prefix is no longer
  load-bearing; an old/new prefix mismatch can't break references because
  nothing keys off the literal.
- **Fewer co-located literals.** Logical-name references plus exports/SSM remove
  the hard-coded `${ProjectName}-...` strings that have to be kept in sync.
- **Composes with ADRs 0001 and 0003.** Single-source-of-truth naming and
  tag-based identity (Project / Environment / ManagedBy tags) mean the physical
  name is cosmetic, which is exactly the state we want.

### Negative / Trade-offs

- **Less human-friendly names.** Auto-generated names (e.g.,
  `nlm-ckn-frontend-1a2b3c4d`) are harder to recognize in the console and CLI.
  Tag-based identity (ADR 0003) is the intended mitigation: filter and
  group by `Project`/`Environment` tags rather than by name.
- **Cross-stack discipline required.** Consumers must go through exports/SSM
  instead of reconstructing names. This is more correct but slightly more
  verbose, and it requires the producing stack to export every name a consumer
  needs.
- **No retroactive benefit for existing resources (the replacement caveat).**
  The currently deployed `cell-kn-*` buckets, ECR repository, IAM roles, and
  ECS cluster already have explicit names. Removing those properties on the
  live stacks would itself trigger a replacement — the very harm we're avoiding.
  Therefore:
  - Leave existing `cell-kn-*` resources in place with their current names.
  - Tag them (`Project`, `Environment`, `ManagedBy`) so identity lives in tags
    (ADR 0003).
  - Document the legacy `cell-kn` prefix in the CloudFormation README.
  - Apply this ADR to everything **new** going forward.

## Alternatives Considered

1. **Keep explicit names, fix the rename in place.** Rename every
   `cell-kn-*` literal to `nlm-ckn-*`. Rejected: this forces replacement of
   stateful resources (S3 data, ECR images, IAM role ARNs referenced by
   policies and SSM) and re-introduces the same coupling that caused the drift.
2. **Keep explicit names but centralize the prefix only (ADR 0001
   alone).** Drive every name from a single `ProjectName`. This reduces the
   number of edit sites but does **not** remove the replace-on-rename problem,
   because the prefix is still embedded in immutable physical names. Adopted as
   complementary, not sufficient on its own.
3. **Tag-based identity only (ADR 0003 alone).** Tag everything and ignore
   names. Necessary but insufficient: it makes drift *harmless* but, on its own,
   still leaves stateful resources carrying name-derived identity. Best combined
   with this ADR.

## References

- Related: ADR 0001 (single source of truth), ADR 0003 (tag-based identity).
- Current explicit-name usages cited above:
  `cloudformation/shared/shared-resources.yaml`,
  `cloudformation/environment/frontend.yaml`,
  `cloudformation/environment/alb.yaml`,
  `cloudformation/environment/backend.yaml`,
  `cloudformation/environment/arangodb.yaml`,
  `cloudformation/environment/monitoring.yaml`,
  `cloudformation/environment/ecs-cluster.yaml`.
