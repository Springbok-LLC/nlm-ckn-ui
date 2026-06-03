import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllSearchableFields } from "./collections";

/**
 * Searchability contract test.
 *
 * The ArangoSearch view (__fixtures__/indexed.json) defines, per collection, which
 * document attributes are indexed and therefore *matchable* by the backend
 * SEARCH clause. However, a field is only searched in practice if the frontend
 * includes it in the `search_fields` it sends to /arango_api/search/.
 *
 * That list comes from getAllSearchableFields(), which is derived from the
 * collection-maps config (individual_fields[].field_to_display) -- a SEPARATE
 * source from the view definition. If the two drift apart, a field can be
 * indexed in the view yet never actually searched (or vice-versa).
 *
 * This test asserts every field indexed by the view is covered by the frontend
 * searchable set, so "all view fields are searchable" stays true.
 *
 * NOTE: This is the real coverage gate. It does NOT involve LABEL_FIELDS in the
 * backend -- those only shape the RETURN projection, not what is searched.
 */
describe("search field coverage", () => {
  // Read the view definition straight from disk so the test tracks the real
  // exported view config, not a hand-maintained copy.
  const viewPath = join(__dirname, "__fixtures__", "indexed.json");
  const view = JSON.parse(readFileSync(viewPath, "utf-8"));

  // Union of every field indexed across all collection links in the view.
  const viewFields = new Set();
  for (const link of Object.values(view.links ?? {})) {
    for (const fieldName of Object.keys(link.fields ?? {})) {
      viewFields.add(fieldName);
    }
  }

  // The fields the frontend actually sends as search_fields.
  const searchableFields = getAllSearchableFields();

  test("the view indexes at least one field (sanity)", () => {
    expect(viewFields.size).toBeGreaterThan(0);
  });

  test("every field indexed by the view is in the frontend searchable set", () => {
    const missing = [...viewFields].filter((field) => !searchableFields.has(field));

    // If this fails, the listed fields are indexed in indexed.json but the
    // frontend never searches them -- add them to a collection's
    // individual_fields in nlm-ckn-collection-maps.json (or remove them from
    // the view if they are intentionally not searchable).
    expect(missing).toEqual([]);
  });

  test.each([
    ["PUB", "title"],
    ["PUB", "author_list"],
    ["CL", "label"],
    ["GS", "gene_symbol"],
  ])("view field %s.%s is searchable", (_collection, fieldName) => {
    expect(searchableFields.has(fieldName)).toBe(true);
  });
});
