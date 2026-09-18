"""
Service for the CL hierarchy rendered by the Browse page.

The hierarchy follows one curated predicate from the root of the CL collection.
Edges are read from their edge collection directly rather than by filtering a
traversal on a predicate label: labels get renamed between ETL releases, and a
stale label filter returns fewer rows with no error.
"""

import logging
import math

logger = logging.getLogger(__name__)

# The predicates offered by the Browse page. Only SUB_CLASS_OF describes a
# usable hierarchy in the loaded data: 3,325 CL nodes under one root. The next
# densest, DEVELOPS_FROM, is a forest of 124 roots over 515 nodes, and the rest
# carry 1-35 edges each. Adding a label here is the only change needed to offer
# it, but confirm it has a single root first.
CL_HIERARCHY_LABELS = {
    "SUB_CLASS_OF": {
        "collection": "CL",
        "edges": "CL-CL",
        "root": "CL/0000000",
        "direction": "INBOUND",
    },
}


class HierarchyServiceError(Exception):
    """Raised when the hierarchy cannot be read."""

    def __init__(self, message, db_error=None):
        super().__init__(message)
        self.db_error = db_error


class UnknownLabelError(ValueError):
    """Raised for a label that is not in the curated config."""


def config_for(label):
    """Return the config for a curated label, or raise UnknownLabelError.

    No caller-supplied string ever reaches AQL as a predicate: the label selects
    a config entry, and only the entry's own values are bound into a query.
    """
    try:
        return CL_HIERARCHY_LABELS[label]
    except KeyError:
        raise UnknownLabelError(
            f"Unknown hierarchy label '{label}'. "
            f"Valid labels: {', '.join(sorted(CL_HIERARCHY_LABELS))}."
        ) from None


def build_descendant_counts(edges):
    """Return {node_id: distinct descendant count} for child -> parent edges.

    The hierarchy is a DAG — a CL node can have several parents — so a node is
    counted once per ancestor, not once per path to it.
    """
    children = {}
    for child, parent in edges:
        children.setdefault(parent, []).append(child)

    memo = {}

    def descendants(node):
        cached = memo.get(node)
        if cached is not None:
            return cached
        memo[node] = set()
        found = set()
        for child in children.get(node, ()):
            found.add(child)
            found |= descendants(child)
        memo[node] = found
        return found

    nodes = set(children)
    for kids in children.values():
        nodes.update(kids)
    return {node: len(descendants(node)) for node in nodes}


def weight_for(count):
    """Return the arc weight for a descendant count.

    Arc widths are sqrt-compressed: the hierarchy is severely skewed, and raw
    counts render the largest branch as a single wedge with unusable slivers
    beside it. Ordering and rough magnitude survive the transform. Callers show
    the raw count, never the weight.
    """
    return max(1, math.sqrt(count))
