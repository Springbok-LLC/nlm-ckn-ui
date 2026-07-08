import { useEffect, useState } from "react";
import { fetchDocument } from "services";

// Session-scoped cache of resolved node documents, keyed by "COLL/key".
const nodeDocumentCache = new Map();

/**
 * Fetches the full document for a graph node id ("COLL/key"), caching results
 * for the session so re-selecting a visited node is instant.
 * @param {string|null} nodeId
 * @returns {{ document: object|null, loading: boolean, error: Error|null }}
 */
export const useNodeDocument = (nodeId) => {
  const [state, setState] = useState({ document: null, loading: false, error: null });

  useEffect(() => {
    if (!nodeId) {
      setState({ document: null, loading: false, error: null });
      return;
    }
    if (nodeDocumentCache.has(nodeId)) {
      setState({ document: nodeDocumentCache.get(nodeId), loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ document: null, loading: true, error: null });
    const [coll, ...rest] = nodeId.split("/");
    const id = rest.join("/");
    fetchDocument(coll, id)
      .then((doc) => {
        if (cancelled) return;
        nodeDocumentCache.set(nodeId, doc);
        setState({ document: doc, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ document: null, loading: false, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  return state;
};
