/**
 * Parsing of ontology node identifiers (CURIEs, OBO ids, PURLs) typed into search.
 */
import { collectionConfigMap } from "./collections";

const IDENTIFIER_PATTERN = /^([A-Za-z][A-Za-z0-9]*)[:_]([A-Za-z0-9._-]+)$/;

/**
 * Node-collection keys eligible as identifier prefixes: everything in
 * collectionConfigMap except the synthetic "edges" entry and jest-only
 * TEST_-prefixed keys, keyed by uppercase prefix for case-insensitive lookup.
 */
const PREFIX_TO_COLLECTION = new Map(
  [...collectionConfigMap.keys()]
    .filter((key) => key !== "edges" && !key.startsWith("TEST_"))
    .map((key) => [key.toUpperCase(), key]),
);

/**
 * Extract the last path segment from a URL string, decoded once.
 * @param {string} token - Candidate URL.
 * @returns {string|null} The decoded last segment, or null if the input is
 *   not a parseable URL or the segment is not a valid percent-encoding.
 */
const lastUrlSegment = (token) => {
  let pathname;
  try {
    pathname = new URL(token).pathname;
  } catch {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  const segment = segments[segments.length - 1];
  if (!segment) return null;

  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * Parse a search query into a node collection and key, if it looks like an
 * ontology identifier (CURIE, OBO-style id, or PURL).
 * @param {string} query - Raw search input.
 * @returns {{collection: string, key: string}|null}
 */
export const parseNodeIdentifier = (query) => {
  const trimmed = String(query).trim();
  const token = /^https?:\/\//i.test(trimmed) ? lastUrlSegment(trimmed) : trimmed;
  if (!token) return null;

  const match = token.match(IDENTIFIER_PATTERN);
  if (!match) return null;

  const [, prefix, key] = match;
  const collection = PREFIX_TO_COLLECTION.get(prefix.toUpperCase());
  return collection ? { collection, key } : null;
};
