# ADR 0001: Single Source of Truth for the Project Name

- **Status:** Proposed
- **Date:** 2026-06-22

## Context

This repository was renamed from `cell-kn` to `nlm-ckn`, but the new name did
not propagate everywhere. The result is a mix of old and new identifiers spread
across the IaC templates, deploy scripts, CI workflows, and the AWS resources
themselves. As of this writing the literal `cell-kn` still appears in roughly 24
CloudFormation files, 32 shell scripts, and 3 GitHub Actions workflows.

The root cause is that the project name is treated as a literal that is
**re-typed in many places** rather than defined once and referenced. The repo is
actually halfway to the right pattern, which makes the drift especially
avoidable:

- The CloudFormation templates already expose a `ProjectName` parameter and
  derive most resource names from it. For example, `cloudformation/environment/backend.yaml`
  builds names like `!Sub '${ProjectName}-${Environment}-backend'`,
  `RoleName: !Sub '${ProjectName}-${Environment}-backend-exec'`, and SSM paths
  like `/${ProjectName}/${Environment}/...`. `cloudformation/shared/shared-resources.yaml`
  does the same for the ECR repo (`${ProjectName}-backend`) and the S3 bucket
  (`${ProjectName}-arangodb-data-${AWS::AccountId}`).
- But the single source of truth is poisoned by its own default: every template
  declares `ProjectName` with `Default: cell-kn`. Any stack deployed without an
  explicit override silently re-introduces the old prefix.
- Scripts re-declare the name as a separate literal. `scripts/app/deploy-backend.sh`
  hard-codes `PROJECT_NAME="cell-kn"` and then composes stack, cluster, and task
  names from it — a parallel source of truth that has already diverged from the
  intended `nlm-ckn`.
- CI hard-codes it inside ARNs. `.github/workflows/ci.yml` assumes
  `role/cell-kn-github-actions` in two places, with no parameter at all.
- Some literals are domain names rather than resource prefixes (e.g.
  `cell-kn.org` in `cloudformation/redirect/redirect.yaml`); those are a separate
  concern and out of scope for this ADR.

So the failure is not the absence of a `ProjectName` parameter — it is that the
name has **several** sources of truth (the CFN default, each script's local
variable, hard-coded CI ARNs), and they were not all updated together.

## Decision

Define the project/namespace string in exactly **one** place per layer and derive
every resource name from it. Never co-locate a hard-coded prefix next to an
existing `ProjectName` parameter.

Concretely:

1. **IaC:** Keep `ProjectName` as the single parameter (or a `locals`/mapping
   block), and pass it explicitly from the parameter files
   (`cloudformation/parameters/*.json`). Resource names must be
   `!Sub '${ProjectName}-${Environment}-<resource>'`, never the literal
   `cell-kn-<resource>`. The `Default` on `ProjectName` should be removed (or set
   to `nlm-ckn`) so an un-passed value fails loudly instead of resurrecting the
   old prefix.
2. **Scripts:** Read the project name from one canonical source rather than
   re-declaring `PROJECT_NAME="cell-kn"` in each script. Prefer resolving it from
   the IaC parameter file / SSM / an exported environment variable, or at minimum
   a single shared shell file that all scripts source.
3. **CI:** Replace hard-coded ARNs such as `role/cell-kn-github-actions` with a
   value derived from a repository/environment variable (e.g.
   `vars.PROJECT_NAME`) so the name lives in one place.

The litmus test: a future rename should touch the project name in a small,
countable number of locations — ideally one per layer — not require a
repo-wide find-and-replace.

## Consequences

**Positive**

- A rename becomes a one-value change per layer instead of a cross-cutting edit
  across ~60 files.
- Eliminates the class of drift where some resources are `cell-kn-*` and others
  are `nlm-ckn-*` within the same deployment.
- Removing the `cell-kn` default makes accidental reuse of the old prefix a hard
  failure at deploy time rather than a silent regression.
- Names stay internally consistent across IaC, scripts, and CI because they
  share an origin.

**Negative / trade-offs**

- The `Default: cell-kn` removal is a breaking change for any workflow that
  relied on it; every deploy path must now pass `ProjectName` explicitly.
- Already-deployed `cell-kn-*` resources (ECR repos, IAM roles, S3 buckets, log
  groups) are not renamed by this decision. Renaming them would force resource
  replacement; the pragmatic path is to leave the legacy resources in place,
  document the prefix, and apply this convention to everything new (see ADR 0002
  on auto-generated physical names and ADR 0003 on tag-based identity).
- Resolving the name from SSM/exports in scripts adds a small amount of
  indirection versus a hard-coded string.

## Alternatives considered

- **Global find-and-replace of `cell-kn` → `nlm-ckn`.** Fixes today's symptom but
  not the cause; the multiple sources of truth remain, so the next rename repeats
  the same drift. Also risks rewriting load-bearing physical names on existing
  AWS resources.
- **Keep per-script `PROJECT_NAME` literals but standardize the value.** Still
  N sources of truth; they will diverge again the moment one script is missed,
  which is exactly the current state.
- **Rename the deployed AWS resources to match.** High blast radius —
  CloudFormation replaces resources when their physical names change — for purely
  cosmetic benefit. Rejected in favor of leaving legacy resources in place.

## References

- `cloudformation/environment/backend.yaml`,
  `cloudformation/shared/shared-resources.yaml` — examples of correct
  `${ProjectName}` derivation.
- `scripts/app/deploy-backend.sh`, `.github/workflows/ci.yml` — examples of
  hard-coded `cell-kn` literals to be parameterized.
