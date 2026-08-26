import { isOntologyListField, parseOntologyTokens } from "config/ontologyFields";
import { useEffect, useMemo, useState } from "react";
import { fetchNodeDetailsByIds } from "services";

// Ontology labels never change within a session, and the same terms recur across
// documents, so one session-scoped cache serves every card.
const ontologyLabelCache = new Map();

// Test-only helper to clear the module-scoped cache so specs stay isolated and
// order-independent. Not part of the public API.
export const __clearOntologyLabelCache = () => ontologyLabelCache.clear();

/**
 * Collect the ontology document ids a document's declared list fields refer to,
 * in document order and without repeats.
 * @param {object|null} document
 * @returns {Array<string>} Ids in "COLL/key" form.
 */
const collectOntologyIds = (document) => {
  if (!document?._id) return [];
  const collection = document._id.split("/")[0];
  const ids = [];
  for (const [key, value] of Object.entries(document)) {
    if (!isOntologyListField(collection, key)) continue;
    for (const { documentId } of parseOntologyTokens(value)) {
      if (!ids.includes(documentId)) ids.push(documentId);
    }
  }
  return ids;
};

/**
 * Resolves the ontology identifiers in a document's list fields to term names.
 *
 * Resolution is against the ontologies graph, not phenotypes: the phenotypes
 * UBERON collection holds only terms linked into that graph, so most tissue
 * identifiers miss there.
 *
 * @param {object|null} document - The document being rendered.
 * @returns {Map<string, string>} documentId -> label. Ids the backend could not
 *   resolve are absent, so callers fall back to showing the identifier.
 */
export const useOntologyLabels = (document) => {
  const ids = useMemo(() => collectOntologyIds(document), [document]);
  // Bumped when a fetch resolves, to re-read the module-scoped cache. The cache
  // itself is the source of truth, so the map identity stays tied to `ids`.
  const [resolvedAt, setResolvedAt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resolvedAt re-triggers this memo to re-read the cache; it is not read inside the callback.
  const missing = useMemo(() => ids.filter((id) => !ontologyLabelCache.has(id)), [ids, resolvedAt]);

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    fetchNodeDetailsByIds(missing, "ontologies")
      .then((docs) => {
        if (cancelled) return;
        for (const doc of docs || []) {
          if (doc?._id && doc.label) ontologyLabelCache.set(doc._id, doc.label);
        }
        setResolvedAt((n) => n + 1);
      })
      .catch(() => {
        // A failed lookup is not an error the panel should surface: every token
        // simply falls back to its identifier.
      });
    return () => {
      cancelled = true;
    };
  }, [missing]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resolvedAt re-triggers this memo to re-read the cache; it is not read inside the callback.
  return useMemo(() => {
    const map = new Map();
    for (const id of ids) {
      const label = ontologyLabelCache.get(id);
      if (label) map.set(id, label);
    }
    return map;
  }, [ids, resolvedAt]);
};
