import { parseNodeIdentifier } from "./identifiers";

describe("parseNodeIdentifier", () => {
  it("parses a CURIE into a collection and key", () => {
    expect(parseNodeIdentifier("UBERON:0002405")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it("parses an OBO-style underscore id into a collection and key", () => {
    expect(parseNodeIdentifier("UBERON_0002405")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it("parses a PURL into a collection and key", () => {
    expect(parseNodeIdentifier("https://purl.obolibrary.org/obo/UBERON_0002405")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it("parses an http:// PURL into a collection and key", () => {
    expect(parseNodeIdentifier("http://purl.obolibrary.org/obo/UBERON_0002405")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseNodeIdentifier("  UBERON:0002405  ")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it("canonicalizes a lowercase prefix", () => {
    expect(parseNodeIdentifier("uberon_0002405")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it("drops a PURL fragment before parsing the last segment", () => {
    expect(parseNodeIdentifier("https://purl.obolibrary.org/obo/UBERON_0002405#section")).toEqual({
      collection: "UBERON",
      key: "0002405",
    });
  });

  it.each([
    ["CL:0000759", "CL", "0000759"],
    ["PR:P06241", "PR", "P06241"],
    ["NCBITaxon:9606", "NCBITaxon", "9606"],
    ["GO_0005886", "GO", "0005886"],
  ])("parses %s across collections", (query, collection, key) => {
    expect(parseNodeIdentifier(query)).toEqual({ collection, key });
  });

  it.each([
    ["FMA:9825", "a prefix not in the collection map"],
    ["immune system", "free text with no identifier shape"],
    ["0002405", "a bare local id with no prefix"],
    ["pericyte", "a plain word"],
    ["T:cell", "a colon inside ordinary text"],
    ["", "an empty string"],
    [null, "null"],
    ["edges:foo", "the synthetic edges collection"],
  ])("returns null for %s (%s)", (query) => {
    expect(parseNodeIdentifier(query)).toBeNull();
  });

  it("returns null for a double-encoded OLS-style URL", () => {
    expect(parseNodeIdentifier("https://www.ebi.ac.uk/ols/UBERON%253A0002405")).toBeNull();
  });

  it("returns null for a partial https:// URL", () => {
    expect(parseNodeIdentifier("https://")).toBeNull();
  });

  it("returns null for a malformed percent escape in the last segment", () => {
    expect(parseNodeIdentifier("https://a.org/obo/%zz")).toBeNull();
  });
});
