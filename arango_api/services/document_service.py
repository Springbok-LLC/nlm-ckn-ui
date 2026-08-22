"""
Service for document retrieval operations.
"""

import logging
import time

from arango_api.services.base import get_db_and_graph
from arango_api.services.collection_service import get_collections

logger = logging.getLogger(__name__)

# Predicate->collection fan-out changes only when a dataset is restored, so a
# coarse TTL is plenty. Mirrors schema_guard.py's cache shape.
CACHE_TTL_SECONDS = 300

# Expiry-only, keyed by graph. Nothing to invalidate — a dataset restore
# replaces the process's view within one TTL.
_predicate_collections_cache = {}


def reset_predicate_collections_cache():
    """Clear the cached predicate->collection maps. Intended for tests."""
    _predicate_collections_cache.clear()


def _get_predicate_collections(graph):
    """Return each edge Label's actual endpoint collections in a graph.

    Gharial's `edge_definitions()` is used only to enumerate which edge
    collections belong to the graph. Endpoints are then computed from the
    real edges, grouped by Label -- NOT from the edge definitions' from/to
    sets, which are collection-level and overstate any label that shares an
    edge collection with another label reaching different endpoints (e.g. the
    seeded graph's NAC_EDGES declares from ["GS", "CHEMBL"] / to ["MONDO",
    "PR"], but PRODUCES only ever occurs on GS -> PR).

    Args:
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        dict | None: Label -> sorted list of collection names, or None if it
        could not be determined (Gharial unreachable). None is the caller's
        signal to fail open -- omit the map rather than break the response.
    """
    now = time.monotonic()
    # Normalize the key. get_db_and_graph() compares case-insensitively, so
    # "Phenotypes" and "phenotypes" resolve to the same database but would
    # otherwise occupy two cache entries -- duplicating the scan and keeping a
    # redundant copy alive for a full TTL. The API serializer rejects
    # case variants, but direct service callers are not bound by it.
    cache_key = (graph or "").lower()
    cached = _predicate_collections_cache.get(cache_key)
    if cached and now < cached["expires_at"]:
        return cached["value"]

    try:
        db, graph_name = get_db_and_graph(graph)
        edge_collections = [
            e["edge_collection"] for e in db.graph(graph_name).edge_definitions()
        ]
        if not edge_collections:
            logger.warning(
                "Graph %r reported no edge definitions; skipping predicate map",
                graph,
            )
            return None

        # Collection names come from Gharial, never from user input, so
        # interpolating them is safe. ArangoDB names cannot contain backticks.
        subqueries = [
            f" (FOR e IN `{name}` "
            f"FILTER e.Label != null "
            f"RETURN DISTINCT {{"
            f"label: e.Label, "
            f"from_coll: PARSE_IDENTIFIER(e._from).collection, "
            f"to_coll: PARSE_IDENTIFIER(e._to).collection"
            f"}}) "
            for name in edge_collections
        ]
        query = "RETURN UNION(" + ", ".join(subqueries) + ")"
        rows = list(db.aql.execute(query))
        triples = rows[0] if rows else []
    except Exception:
        logger.warning(
            "Could not compute predicate collections for graph %r",
            graph,
            exc_info=True,
        )
        return None

    mapping = {}
    for triple in triples:
        label = triple.get("label")
        if not label:
            continue
        collections = mapping.setdefault(label, set())
        collections.add(triple["from_coll"])
        collections.add(triple["to_coll"])

    result = {label: sorted(collections) for label, collections in mapping.items()}

    _predicate_collections_cache[cache_key] = {
        "value": result,
        "expires_at": now + CACHE_TTL_SECONDS,
    }
    return result


def get_documents(document_ids, graph_name):
    """
    Fetches full document details for a list of document IDs.

    Args:
        document_ids (list): List of document IDs in "collection/key" format.
        graph_name (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        list: List of document dictionaries.
    """
    if not isinstance(document_ids, list) or not document_ids:
        return []

    # Group document keys by their collection name
    collections_to_keys = {}
    for doc_id in document_ids:
        try:
            collection_name, key = doc_id.split("/")
            collections_to_keys.setdefault(collection_name, []).append(key)
        except ValueError:
            logger.warning("Skipping malformed document ID: %s", doc_id)
            continue

    if not collections_to_keys:
        return []

    db_connection, _ = get_db_and_graph(graph_name)

    all_results = []
    query = """
        FOR doc IN @@collection
            FILTER doc._key IN @keys
            RETURN doc
    """

    for collection, keys in collections_to_keys.items():
        bind_vars = {"@collection": collection, "keys": keys}
        try:
            cursor = db_connection.aql.execute(query, bind_vars=bind_vars)
            results_for_collection = [doc for doc in cursor]
            all_results.extend(results_for_collection)
        except Exception:
            logger.exception("Error executing query for collection '%s'", collection)
            continue

    return all_results


def get_edge_filter_options(fields_to_query, graph="ontologies"):
    """
    Query database for unique values for specified edge attributes.

    Auto-detects whether each field is numeric or categorical. If >90% of
    non-null values for a field are numeric, returns {type: "numeric", min, max}.
    Otherwise returns {type: "categorical", values: [...]}.

    Args:
        fields_to_query (list): List of field names to get unique values for.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        dict: Dictionary mapping field names to typed filter descriptors.

    Raises:
        Exception: Re-raises database errors for handling by caller.
    """
    if not fields_to_query:
        return {}

    db, _ = get_db_and_graph(graph)

    try:
        edge_collections = get_collections("edge", graph)

        if not edge_collections:
            return {}

        union_subqueries = [
            f" (FOR doc IN `{coll}` RETURN doc) " for coll in edge_collections
        ]
        all_edges_clause = "UNION(" + ", ".join(union_subqueries) + ")"

        query = f"""
            LET all_edges = ({all_edges_clause})

            LET options_per_field = (
                FOR field_name IN @fields_to_query
                    LET values = (
                        FOR edge IN all_edges
                            FILTER HAS(edge, field_name) AND edge[field_name] != null AND edge[field_name] != ""
                            COLLECT value = edge[field_name]
                            RETURN value
                    )
                    LET numeric_values = (
                        FOR v IN values
                            LET n = TO_NUMBER(v)
                            FILTER IS_NUMBER(n) AND n != 0 OR TO_STRING(v) == "0"
                            RETURN n
                    )
                    LET is_numeric = LENGTH(values) > 0 AND LENGTH(numeric_values) / LENGTH(values) > 0.9
                    RETURN is_numeric
                        ? {{ [field_name]: {{ type: "numeric", min: MIN(numeric_values), max: MAX(numeric_values) }} }}
                        : {{ [field_name]: {{ type: "categorical", values: UNIQUE(values) }} }}
            )

            RETURN MERGE(options_per_field)
        """

        bind_vars = {"fields_to_query": fields_to_query}

        cursor = db.aql.execute(query, bind_vars=bind_vars)
        results = list(cursor)[0]

        # Additive: this does not replace the UNION query above, which also
        # does the >90%-numeric type detection and needs real values, not
        # distinct label triples. Reserved `_`-prefixed key so it cannot
        # collide with a field name and existing consumers can filter it out.
        predicate_collections = _get_predicate_collections(graph)
        if predicate_collections is not None:
            results["_predicateCollections"] = predicate_collections

        return results

    except Exception:
        logger.exception("Error executing edge_filter_options query")
        raise
