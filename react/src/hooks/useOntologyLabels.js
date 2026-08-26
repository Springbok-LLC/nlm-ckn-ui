import { isOntologyListField, parseOntologyTokens } from "config/ontologyFields";
import { useEffect, useMemo, useState } from "react";
import { fetchNodeDetailsByIds } from "services";

// Ontology labels never change within a session, and the same terms recur across
// documents, so one session-scoped cache serves every card.
const ontologyLabelCache = new Map();

// Ids already sent to the details endpoint. An id the backend cannot resolve
// never lands in the cache, so without this it stays "missing" forever: each
// response re-renders the hook, the missing list is rebuilt with a fresh
// identity, and the effect refetches at network cadence for as long as the card
// is open. Shares the cache's module scope, and is cleared alongside it.
const attemptedOntologyIds = new Set();

/**
 * Test-only helper to clear the module-scoped label cache and attempted-id set
 * so specs stay isolated and order-independent. Not part of the public API.
 * @returns {void}
 */
export const __clearOntologyLabelCache = () => {
  ontologyLabelCache.clear();
  attemptedOntologyIds.clear();
};

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
  const missing = useMemo(
    () => ids.filter((id) => !ontologyLabelCache.has(id) && !attemptedOntologyIds.has(id)),
    [ids, resolvedAt],
  );

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    fetchNodeDetailsByIds(missing, "ontologies")
      .then((docs) => {
        // Cache and mark attempted regardless of `cancelled`: the request was
        // made and its answer is good for the session, even if this render is
        // gone. Only the state bump is unmount-sensitive.
        let added = false;
        for (const doc of docs || []) {
          if (doc?._id && doc.label) {
            ontologyLabelCache.set(doc._id, doc.label);
            added = true;
          }
        }
        for (const id of missing) attemptedOntologyIds.add(id);
        // A response that resolved nothing must not re-render: that is what
        // rebuilt `missing` and drove the refetch loop.
        if (cancelled || !added) return;
        setResolvedAt((n) => n + 1);
      })
      .catch(() => {
        // A failed lookup is not an error the panel should surface: every token
        // simply falls back to its identifier. Deliberately does not mark the
        // ids attempted — a rejection is transient — and cannot loop, because
        // it never bumps state.
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
