/**
 * UI-local declaration of which document attributes hold lists of ontology
 * terms, encoded as "PREFIX:LOCAL: COUNT" and joined with " | ".
 *
 * The sidebar renders these as term names rather than identifiers (nlm-ckn#311),
 * resolving each identifier against the ontologies graph. Only fields whose
 * prefix has a collection there can be declared: CSD.assay_summary has the same
 * shape but names EFO terms, and no graph carries an EFO collection.
 *
 * This config is presentation-only and intentionally lives in the UI, for the
 * same reason as `geneFields`: `assets/nlm-ckn-collection-maps.json` is kept
 * byte-identical with the ETL repo by a sync workflow, and its `field_url`
 * mechanism produces one URL per field, never one per token.
 */
export const ontologyFields = {
  CSD: ["tissue_annotation"],
};

/**
 * Lookup form of the config. Collection names arrive from document ids, so a Map
 * keeps names like "constructor" from resolving to inherited object properties.
 */
const ontologyFieldsByCollection = new Map(Object.entries(ontologyFields));

/** Matches "UBERON:0002174: 65770", with the count optional. */
const ONTOLOGY_TOKEN = /^([A-Za-z][A-Za-z0-9_]*):([^\s:]+)(?::\s*(\d+))?$/;

/**
 * Whether a document attribute should be rendered as a list of ontology terms.
 * @param {string} collection - Collection abbreviation, e.g. "CSD".
 * @param {string} fieldKey - Attribute name, e.g. "tissue_annotation".
 * @returns {boolean} True when the field holds ontology identifiers.
 */
export const isOntologyListField = (collection, fieldKey) =>
  Boolean(fieldKey) && (ontologyFieldsByCollection.get(collection) || []).includes(fieldKey);

/**
 * Split an ontology list value into tokens.
 *
 * Unparseable tokens are dropped rather than rendered: a stray value carries no
 * term to name and no page to link to. Nothing guarantees a list holds distinct
 * terms, so a repeat is keyed by its occurrence number rather than its index.
 *
 * @param {*} value - Raw attribute value (string, or array of strings).
 * @returns {Array<{curie: string, documentId: string, count: number|null, key: string}>}
 */
export const parseOntologyTokens = (value) => {
  const raw = Array.isArray(value) ? value.join(" | ") : value;
  if (typeof raw !== "string") return [];

  const seen = new Map();
  const tokens = [];
  for (const part of raw.split("|")) {
    const match = ONTOLOGY_TOKEN.exec(part.trim());
    if (!match) continue;
    const [, prefix, local, count] = match;
    const curie = `${prefix}:${local}`;
    const occurrence = seen.get(curie) ?? 0;
    seen.set(curie, occurrence + 1);
    tokens.push({
      curie,
      documentId: `${prefix}/${local}`,
      count: count === undefined ? null : Number(count),
      key: `${curie}-${occurrence}`,
    });
  }
  return tokens;
};
