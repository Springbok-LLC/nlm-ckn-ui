"""Search relevance metrics, scored against a golden query list.

A golden query list is a small set of realistic searches, each paired with the
node a user should find first ("T cell" -> CL/0000084). Running it before and
after a ranking change shows, query by query, whether the change helped.
One node is right for each query, so its position is what matters. Per run:
- success@1: share of queries with the expected node first.
- success@5: share with it in the top five, visible without scrolling.
- MRR (mean reciprocal rank, the mean of 1/rank): unlike the two cutoffs, it
  moves when a node climbs from rank 29 to 6, or slips from 2 to 4.

Each query belongs to one group, and the numbers are reported per group:
- ranking: everyday searches by name ("T cell", "kidney").
- identifier: searches by ID ("CL:0000084").
- known_gap: searches not expected to work yet, kept so progress is visible.
A change is rejected only when a ranking or identifier query ranks lower.

A baseline is the rank each query got on the last accepted run. A new run is
compared with it, and the change is rejected if a ranking or identifier query
that was in the top five now ranks lower, or if a group's success@1, success@5
or MRR falls by more than AGGREGATE_TOLERANCE (0.03, just under one query in
the 31 ranking queries). known_gap queries never cause a rejection.
"""

import json

REQUIRED_GROUPS = ("ranking", "identifier")
GROUPS = REQUIRED_GROUPS + ("known_gap",)

# Largest fall allowed in a group's success@1, success@5 or MRR: just under one
# query in the 31 ranking queries, so losing a single query is not flagged.
AGGREGATE_TOLERANCE = 0.03


def rank_of(result_ids, expected_ids):
    """1-based rank of the first expected id in the results, else None."""
    expected = set(expected_ids)
    for position, result_id in enumerate(result_ids, start=1):
        if result_id in expected:
            return position
    return None


def success_at(ranks, k):
    """Fraction of queries whose expected id ranked within the top k (0 if none)."""
    if not ranks:
        return 0.0
    return sum(1 for r in ranks if r is not None and r <= k) / len(ranks)


def mrr(ranks):
    """Mean reciprocal rank; a missing rank contributes zero (0 if empty)."""
    if not ranks:
        return 0.0
    return sum(1 / r for r in ranks if r is not None) / len(ranks)


def score_groups(ranks_by_query, golden):
    """Per-group n, success@1, success@5 and MRR (empty groups are omitted)."""
    scores = {}
    for name in GROUPS:
        ranks = [ranks_by_query[g["query"]] for g in golden if g["group"] == name]
        if ranks:
            scores[name] = {
                "n": len(ranks),
                "success_at_1": success_at(ranks, 1),
                "success_at_5": success_at(ranks, 5),
                "mrr": mrr(ranks),
            }
    return scores


def _worse(current, baseline):
    """True when `current` is a lower position than `baseline` (no rank is the lowest)."""
    if current == baseline:
        return False
    return current is None or (baseline is not None and current > baseline)


def compare_to_baseline(current_ranks, baseline_ranks, golden):
    """Compare this run's ranks with the baseline's, query by query and per group.

    Returns a dict of three lists:
    - regressions: ranking or identifier queries that were in the top five in
      the baseline and now rank lower (or are no longer found).
    - aggregate_drops: group metrics (success@1, success@5, MRR) that fell by
      more than AGGREGATE_TOLERANCE.
    - improvements: queries of any group that now rank higher.
    A query missing from the baseline has no earlier rank, so it cannot regress.
    """
    regressions, improvements = [], []
    for g in golden:
        query = g["query"]
        now, before = current_ranks[query], baseline_ranks.get(query)
        change = {"query": query, "baseline": before, "current": now}
        if _worse(before, now):
            improvements.append(change)
        elif _worse(now, before) and g["group"] in REQUIRED_GROUPS:
            if before is not None and before <= 5:
                regressions.append(change)
    baseline = {g["query"]: baseline_ranks.get(g["query"]) for g in golden}
    now_scores = score_groups(current_ranks, golden)
    before_scores = score_groups(baseline, golden)
    aggregate_drops = []
    for name in filter(now_scores.get, REQUIRED_GROUPS):
        for metric in ("success_at_1", "success_at_5", "mrr"):
            before, now = before_scores[name][metric], now_scores[name][metric]
            # Rounding keeps a drop of exactly the tolerance from being flagged
            # by floating-point noise.
            if round(before - now, 9) > AGGREGATE_TOLERANCE:
                aggregate_drops.append(
                    {
                        "group": name,
                        "metric": metric,
                        "baseline": before,
                        "current": now,
                    }
                )
    return {
        "regressions": regressions,
        "aggregate_drops": aggregate_drops,
        "improvements": improvements,
    }


def format_report(scores, comparison=None):
    """Text table of the per-group scores, for people to read.

    When a comparison is given, each regression and aggregate drop is listed
    below the table.
    """
    lines = [f"{'group':<12}{'n':>4}{'s@1':>8}{'s@5':>8}{'mrr':>8}"]
    for name, s in scores.items():
        lines.append(
            f"{name:<12}{s['n']:>4}{s['success_at_1']:>8.2f}"
            f"{s['success_at_5']:>8.2f}{s['mrr']:>8.2f}"
        )
    for r in (comparison or {}).get("regressions", []):
        lines.append(f"REGRESSION {r['query']!r}: {r['baseline']} -> {r['current']}")
    for d in (comparison or {}).get("aggregate_drops", []):
        lines.append(
            f"REGRESSION {d['group']} {d['metric']}: "
            f"{d['baseline']:.2f} -> {d['current']:.2f}"
        )
    return "\n".join(lines)


def load_golden(path):
    """Load and validate the golden query list; ValueError names a bad entry."""
    with open(path, encoding="utf-8") as fh:
        entries = json.load(fh)
    if not isinstance(entries, list):
        raise ValueError("golden file must be a list of entries")
    seen = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"golden entry {index}: must be an object: {entry!r}")
        query = entry.get("query")
        expected = entry.get("expected_ids")
        problem = None
        if not isinstance(query, str) or not query:
            problem = "query must be a non-empty string"
        elif not isinstance(expected, list) or not expected:
            problem = "expected_ids must be a non-empty list"
        elif not all(isinstance(i, str) for i in expected):
            problem = "expected_ids must all be strings"
        elif entry.get("group") not in GROUPS:
            problem = f"group must be one of {GROUPS}"
        elif query in seen:
            problem = "duplicate query"
        if problem:
            raise ValueError(f"golden entry {index}: {problem}: {query!r}")
        seen.add(query)
    return entries
