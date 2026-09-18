"""Unit tests for hierarchy_service. No database required."""

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
        self.assertEqual(config["direction"], "INBOUND")

    def test_unknown_label_is_rejected(self):
        with self.assertRaises(hierarchy_service.UnknownLabelError):
            hierarchy_service.config_for("NOT_A_PREDICATE")
