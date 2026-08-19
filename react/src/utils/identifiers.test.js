import { parseNodeIdentifier } from "./identifiers";

describe("parseNodeIdentifier", () => {
  it.each([
    ["a CURIE", "UBERON:0002405", "UBERON", "0002405"],
    ["an OBO-style underscore id", "UBERON_0002405", "UBERON", "0002405"],
    ["a PURL", "https://purl.obolibrary.org/obo/UBERON_0002405", "UBERON", "0002405"],
    ["an http:// PURL", "http://purl.obolibrary.org/obo/UBERON_0002405", "UBERON", "0002405"],
    [
      "an uppercase-scheme PURL",
      "HTTPS://purl.obolibrary.org/obo/UBERON_0002405",
      "UBERON",
      "0002405",
    ],
    ["surrounding whitespace", "  UBERON:0002405  ", "UBERON", "0002405"],
    ["a lowercase prefix", "uberon_0002405", "UBERON", "0002405"],
    [
      "a PURL fragment",
      "https://purl.obolibrary.org/obo/UBERON_0002405#section",
      "UBERON",
      "0002405",
    ],
    ["a CL id", "CL:0000759", "CL", "0000759"],
    ["a PR id", "PR:P06241", "PR", "P06241"],
    ["an NCBITaxon id", "NCBITaxon:9606", "NCBITaxon", "9606"],
    ["a GO underscore id", "GO_0005886", "GO", "0005886"],
  ])("parses %s into a collection and key", (_label, query, collection, key) => {
    expect(parseNodeIdentifier(query)).toEqual({ collection, key });
  });

  it.each([
    ["a prefix not in the collection map", "FMA:9825"],
    ["free text with no identifier shape", "immune system"],
    ["a bare local id with no prefix", "0002405"],
    ["a plain word", "pericyte"],
    ["a colon inside ordinary text", "T:cell"],
    ["an empty string", ""],
    ["null", null],
    ["the synthetic edges collection", "edges:foo"],
    ["a double-encoded OLS-style URL", "https://www.ebi.ac.uk/ols/UBERON%253A0002405"],
    ["a partial https:// URL", "https://"],
    ["a malformed percent escape in the last segment", "https://a.org/obo/%zz"],
  ])("returns null for %s", (_label, query) => {
    expect(parseNodeIdentifier(query)).toBeNull();
  });
});
