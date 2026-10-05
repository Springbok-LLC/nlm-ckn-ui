"""Unit tests for the search relevance evaluation library (no database)."""

import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from arango_api import search_eval as ev


class RankOfTestCase(SimpleTestCase):
    def test_found_returns_one_based_rank(self):
        self.assertEqual(ev.rank_of(["a", "b", "c"], ["c"]), 3)

    def test_first_of_several_expected_wins(self):
        self.assertEqual(ev.rank_of(["a", "b", "c"], ["c", "b"]), 2)

    def test_absent_returns_none(self):
        self.assertIsNone(ev.rank_of(["a", "b"], ["z"]))

    def test_empty_expected_returns_none(self):
        self.assertIsNone(ev.rank_of(["a", "b"], []))


class MetricsTestCase(SimpleTestCase):
    RANKS = [1, 3, None, 6]

    def test_success_at_counts_ranks_within_k(self):
        self.assertEqual(ev.success_at(self.RANKS, 1), 0.25)
        self.assertEqual(ev.success_at(self.RANKS, 5), 0.5)

    def test_mrr_treats_none_as_zero(self):
        self.assertAlmostEqual(ev.mrr(self.RANKS), (1 + 1 / 3 + 0 + 1 / 6) / 4)

    def test_empty_ranks_score_zero(self):
        self.assertEqual(ev.success_at([], 5), 0.0)
        self.assertEqual(ev.mrr([]), 0.0)


def _golden_file(entries):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(entries, handle)
    handle.close()
    return Path(handle.name)


def _entry(query="t cell", expected=("CL/1",), group="ranking"):
    return {"query": query, "expected_ids": list(expected), "group": group}


class LoadGoldenTestCase(SimpleTestCase):
    def _load(self, entries):
        path = _golden_file(entries)
        self.addCleanup(path.unlink)
        return ev.load_golden(path)

    def test_valid_file_loads(self):
        entries = [_entry("a"), _entry("b", group="known_gap")]
        self.assertEqual(self._load(entries), entries)

    def test_rejects_bad_entries_naming_them(self):
        bad = {
            "missing query": {"expected_ids": ["CL/1"], "group": "ranking"},
            "empty query": _entry(query=""),
            "unknown group": _entry("q-group", group="other"),
            "empty expected_ids": _entry("q-empty", expected=()),
            "non-string id": _entry("q-type", expected=(1,)),
        }
        for label, entry in bad.items():
            with self.subTest(label), self.assertRaises(ValueError) as ctx:
                self._load([_entry("ok"), entry])
            self.assertIn("entry 1", str(ctx.exception))

    def test_rejects_non_list_top_level(self):
        with self.assertRaisesRegex(ValueError, "list of entries"):
            self._load({"query": "x"})

    def test_rejects_non_dict_entry_naming_it(self):
        with self.assertRaisesRegex(ValueError, "entry 0"):
            self._load(["x"])

    def test_rejects_duplicate_query(self):
        with self.assertRaisesRegex(ValueError, "duplicate.*t cell"):
            self._load([_entry("t cell"), _entry("t cell", group="known_gap")])


GOLDEN = [
    _entry("r1"),
    _entry("r2"),
    _entry("i1", group="identifier"),
    _entry("p1", group="known_gap"),
]


class ScoreGroupsTestCase(SimpleTestCase):
    def test_groups_are_scored_separately(self):
        ranks = {"r1": 1, "r2": None, "i1": 2, "p1": 1}
        scores = ev.score_groups(ranks, GOLDEN)
        self.assertEqual(
            scores["ranking"],
            {"n": 2, "success_at_1": 0.5, "success_at_5": 0.5, "mrr": 0.5},
        )
        self.assertEqual(
            scores["identifier"],
            {"n": 1, "success_at_1": 0.0, "success_at_5": 1.0, "mrr": 0.5},
        )
        self.assertEqual(
            scores["known_gap"],
            {"n": 1, "success_at_1": 1.0, "success_at_5": 1.0, "mrr": 1.0},
        )


class CompareToBaselineTestCase(SimpleTestCase):
    BASELINE = {"r1": 1, "r2": 4, "i1": 7, "p1": 1}

    def _compare(self, **changes):
        current = {**self.BASELINE, **changes}
        return ev.compare_to_baseline(current, self.BASELINE, GOLDEN)

    def _regressed(self, result):
        return [r["query"] for r in result["regressions"]]

    def test_unchanged_is_clean(self):
        result = self._compare()
        self.assertEqual(result["regressions"], [])
        self.assertEqual(result["improvements"], [])

    def test_worsening_inside_top_five_regresses(self):
        self.assertEqual(self._regressed(self._compare(r1=2)), ["r1"])

    def test_falling_out_of_top_five_regresses(self):
        self.assertEqual(self._regressed(self._compare(r2=None)), ["r2"])
        self.assertEqual(self._regressed(self._compare(r2=9)), ["r2"])

    def test_already_outside_top_five_cannot_regress(self):
        self.assertEqual(self._regressed(self._compare(i1=None)), [])
        self.assertEqual(self._regressed(self._compare(i1=12)), [])

    def test_known_gap_never_regresses(self):
        self.assertEqual(self._regressed(self._compare(p1=None)), [])

    def test_better_rank_is_an_improvement(self):
        result = self._compare(r2=2, i1=3)
        self.assertEqual([i["query"] for i in result["improvements"]], ["r2", "i1"])
        self.assertEqual(result["regressions"], [])


class FormatReportTestCase(SimpleTestCase):
    def test_report_lists_groups_and_regressions(self):
        baseline = {"r1": 1, "r2": 4, "i1": 7, "p1": 1}
        current = {**baseline, "r1": 3}
        comparison = ev.compare_to_baseline(current, baseline, GOLDEN)
        report = ev.format_report(ev.score_groups(current, GOLDEN), comparison)
        for text in ("ranking", "identifier", "known_gap", "mrr", "REGRESSION", "r1"):
            self.assertIn(text, report)

    def test_report_without_comparison_has_no_regression_section(self):
        report = ev.format_report(
            ev.score_groups({"r1": 1, "r2": 1, "i1": 1, "p1": 1}, GOLDEN)
        )
        self.assertNotIn("REGRESSION", report)


class AggregateToleranceTestCase(SimpleTestCase):
    def _drops(self, current_hits):
        # 100 ranking queries; the first `hits` rank 1, the rest are absent.
        golden = [_entry(f"q{i}") for i in range(100)]
        baseline = {f"q{i}": 1 if i < 50 else None for i in range(100)}
        current = {f"q{i}": 1 if i < current_hits else None for i in range(100)}
        result = ev.compare_to_baseline(current, baseline, golden)
        return {(d["group"], d["metric"]) for d in result["aggregate_drops"]}

    def test_drop_of_exactly_tolerance_is_allowed(self):
        self.assertEqual(self._drops(47), set())

    def test_drop_beyond_tolerance_is_reported(self):
        self.assertEqual(
            self._drops(46),
            {
                ("ranking", "success_at_1"),
                ("ranking", "success_at_5"),
                ("ranking", "mrr"),
            },
        )
