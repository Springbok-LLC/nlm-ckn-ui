"""Unit tests for hierarchy_service. No database required."""

from unittest import mock

from django.test import SimpleTestCase

from arango_api.services import hierarchy_service


class BuildDescendantCountsTestCase(SimpleTestCase):
    """Tests for build_descendant_counts."""

    def test_counts_distinct_descendants_in_a_chain(self):
        # a <- b <- c  (edges point child -> parent)
        edges = [("CL/b", "CL/a"), ("CL/c", "CL/b")]

        counts = hierarchy_service.build_descendant_counts(edges)

        self.assertEqual(counts["CL/a"], 2)
        self.assertEqual(counts["CL/b"], 1)
        self.assertEqual(counts["CL/c"], 0)

    def test_counts_a_shared_descendant_once_per_ancestor(self):
        # d has two parents, b and c, both under a
        edges = [
            ("CL/b", "CL/a"),
            ("CL/c", "CL/a"),
            ("CL/d", "CL/b"),
            ("CL/d", "CL/c"),
        ]

        counts = hierarchy_service.build_descendant_counts(edges)

        # a reaches b, c and d — d once, not twice
        self.assertEqual(counts["CL/a"], 3)
        self.assertEqual(counts["CL/b"], 1)
        self.assertEqual(counts["CL/c"], 1)


class WeightForTestCase(SimpleTestCase):
    """Tests for weight_for."""

    def test_weight_is_the_square_root_of_the_count(self):
        self.assertAlmostEqual(hierarchy_service.weight_for(3155), 56.169, places=2)

    def test_weight_of_a_leaf_is_one(self):
        self.assertEqual(hierarchy_service.weight_for(0), 1)


class LabelConfigTestCase(SimpleTestCase):
    """Tests for the curated label config."""

    def test_sub_class_of_is_configured_from_the_cl_root(self):
        config = hierarchy_service.CL_HIERARCHY_LABELS["SUB_CLASS_OF"]

        self.assertEqual(config["collection"], "CL")
        self.assertEqual(config["edges"], "CL-CL")
        self.assertEqual(config["root"], "CL/0000000")

    def test_unknown_label_is_rejected(self):
        with self.assertRaises(hierarchy_service.UnknownLabelError):
            hierarchy_service.config_for("NOT_A_PREDICATE")


class _FakeCursor:
    """Iterates once over a fixed count, like an AQL COLLECT WITH COUNT cursor."""

    def __init__(self, count):
        self._count = count

    def __iter__(self):
        return iter([self._count])


class _FakeAQL:
    def __init__(self, counts_by_label):
        self._counts_by_label = counts_by_label

    def execute(self, query, bind_vars):
        return _FakeCursor(self._counts_by_label[bind_vars["label"]])


class _FakeDB:
    def __init__(self, counts_by_label):
        self.aql = _FakeAQL(counts_by_label)


class AvailableLabelsTestCase(SimpleTestCase):
    """Tests for available_labels's filtering of labels absent from the data.

    This filtering is what turns a renamed predicate into a visible error
    instead of an empty chart, so it is covered directly against a fake db
    rather than relying on the fixtures happening to include every label.
    """

    def test_omits_a_configured_label_with_no_edges_in_the_data(self):
        fake_config = {
            "SUB_CLASS_OF": {
                "collection": "CL",
                "edges": "CL-CL",
                "root": "CL/0000000",
            },
            "RENAMED_PREDICATE": {
                "collection": "CL",
                "edges": "CL-CL",
                "root": "CL/0000000",
            },
        }
        fake_db = _FakeDB({"SUB_CLASS_OF": 6, "RENAMED_PREDICATE": 0})

        with mock.patch.object(
            hierarchy_service, "CL_HIERARCHY_LABELS", fake_config
        ), mock.patch.object(hierarchy_service, "db_ontologies", fake_db):
            labels = hierarchy_service.available_labels()

        self.assertEqual([entry["label"] for entry in labels], ["SUB_CLASS_OF"])
