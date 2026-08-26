import { renderHook, waitFor } from "@testing-library/react";
import { __clearOntologyLabelCache, useOntologyLabels } from "./useOntologyLabels";

jest.mock("services", () => ({
  fetchNodeDetailsByIds: jest.fn(),
}));

import { fetchNodeDetailsByIds } from "services";

const csd = (overrides = {}) => ({
  _id: "CSD/abc123",
  tissue_annotation: "UBERON:0002174: 65770 | UBERON:0002171: 18003",
  ...overrides,
});

describe("useOntologyLabels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __clearOntologyLabelCache();
  });

  it("returns an empty map and fetches nothing for a null document", () => {
    const { result } = renderHook(() => useOntologyLabels(null));
    expect(result.current.size).toBe(0);
    expect(fetchNodeDetailsByIds).not.toHaveBeenCalled();
  });

  it("fetches every identifier in one batch against the ontologies graph", async () => {
    fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0002174", label: "middle lobe of right lung" },
      { _id: "UBERON/0002171", label: "lower lobe of right lung" },
    ]);
    const { result } = renderHook(() => useOntologyLabels(csd()));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(fetchNodeDetailsByIds).toHaveBeenCalledTimes(1);
    expect(fetchNodeDetailsByIds).toHaveBeenCalledWith(
      ["UBERON/0002174", "UBERON/0002171"],
      "ontologies",
    );
    expect(result.current.get("UBERON/0002174")).toBe("middle lobe of right lung");
  });

  it("does not refetch identifiers already resolved", async () => {
    fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0002174", label: "middle lobe of right lung" },
      { _id: "UBERON/0002171", label: "lower lobe of right lung" },
    ]);
    const first = renderHook(() => useOntologyLabels(csd()));
    await waitFor(() => expect(first.result.current.size).toBe(2));
    fetchNodeDetailsByIds.mockClear();

    const second = renderHook(() => useOntologyLabels(csd()));
    expect(second.result.current.get("UBERON/0002171")).toBe("lower lobe of right lung");
    expect(fetchNodeDetailsByIds).not.toHaveBeenCalled();
  });

  it("fetches nothing for a document with no ontology list fields", () => {
    renderHook(() => useOntologyLabels({ _id: "CS/abc", species: "Homo sapiens" }));
    expect(fetchNodeDetailsByIds).not.toHaveBeenCalled();
  });

  it("leaves identifiers the backend could not resolve out of the map", async () => {
    fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0002174", label: "middle lobe of right lung" },
    ]);
    const { result } = renderHook(() => useOntologyLabels(csd()));
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.has("UBERON/0002171")).toBe(false);
  });

  it("survives a failed fetch without throwing", async () => {
    fetchNodeDetailsByIds.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useOntologyLabels(csd()));
    await waitFor(() => expect(fetchNodeDetailsByIds).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
