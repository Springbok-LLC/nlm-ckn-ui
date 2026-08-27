import { isOntologyListField, parseOntologyTokens } from "./ontologyFields";

describe("isOntologyListField", () => {
  it("recognises the CSD tissue field", () => {
    expect(isOntologyListField("CSD", "tissue_annotation")).toBe(true);
  });

  it("rejects fields and collections that are not declared", () => {
    // assay_summary has the same shape but resolves against EFO, which no graph
    // carries, so it is deliberately not declared.
    expect(isOntologyListField("CSD", "assay_summary")).toBe(false);
    expect(isOntologyListField("CS", "tissue_annotation")).toBe(false);
    expect(isOntologyListField("CSD", undefined)).toBe(false);
  });
});

describe("parseOntologyTokens", () => {
  it("splits a pipe-delimited list into curie/document-id pairs", () => {
    const tokens = parseOntologyTokens("UBERON:0002174: 65770 | UBERON:0002171: 18003");
    expect(tokens).toEqual([
      {
        curie: "UBERON:0002174",
        documentId: "UBERON/0002174",
        key: "UBERON:0002174-0",
      },
      {
        curie: "UBERON:0002171",
        documentId: "UBERON/0002171",
        key: "UBERON:0002171-0",
      },
    ]);
  });

  it("handles a single token with no delimiter", () => {
    expect(parseOntologyTokens("UBERON:0001225: 19985")).toEqual([
      {
        curie: "UBERON:0001225",
        documentId: "UBERON/0001225",
        key: "UBERON:0001225-0",
      },
    ]);
  });

  it("keeps a token that carries no count suffix", () => {
    expect(parseOntologyTokens("UBERON:0001225")).toEqual([
      {
        curie: "UBERON:0001225",
        documentId: "UBERON/0001225",
        key: "UBERON:0001225-0",
      },
    ]);
  });

  it("disambiguates a repeated term by occurrence", () => {
    const tokens = parseOntologyTokens("UBERON:0002048: 10 | UBERON:0002048: 20");
    expect(tokens.map((t) => t.key)).toEqual(["UBERON:0002048-0", "UBERON:0002048-1"]);
  });

  it("drops blank and unparseable tokens", () => {
    expect(parseOntologyTokens("UBERON:0002048: 10 |  | 064 ")).toEqual([
      { curie: "UBERON:0002048", documentId: "UBERON/0002048", key: "UBERON:0002048-0" },
    ]);
  });

  it("returns an empty list for non-string input", () => {
    expect(parseOntologyTokens(undefined)).toEqual([]);
    expect(parseOntologyTokens(42)).toEqual([]);
  });
});
