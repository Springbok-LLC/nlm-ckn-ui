import { act, renderHook, waitFor } from "@testing-library/react";
import { __clearOntologyLabelCache, useOntologyLabels } from "./useOntologyLabels";

jest.mock("services", () => ({
  fetchNodeDetailsByIds: jest.fn(),
}));

import { fetchNodeDetailsByIds } from "services";

// Let any fetch/re-render cycles the hook triggers run to exhaustion before
// counting calls: a single await would pass even while the hook is looping.
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

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

  it("does not re-request an identifier a partial response left unresolved", async () => {
    fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0002174", label: "middle lobe of right lung" },
    ]);
    const { result } = renderHook(() => useOntologyLabels(csd()));
    await settle();
    expect(fetchNodeDetailsByIds).toHaveBeenCalledTimes(1);
    expect(result.current.get("UBERON/0002174")).toBe("middle lobe of right lung");
    expect(result.current.has("UBERON/0002171")).toBe(false);
  });

  it("does not re-request identifiers after an empty response", async () => {
    // The shape a failed lookup actually takes: fetchNodeDetailsByIds swallows
    // errors and resolves an empty list rather than rejecting.
    fetchNodeDetailsByIds.mockResolvedValue([]);
    const { result } = renderHook(() => useOntologyLabels(csd()));
    await settle();
    expect(fetchNodeDetailsByIds).toHaveBeenCalledTimes(1);
    expect(result.current.size).toBe(0);
  });

  it("survives a failed fetch without throwing", async () => {
    fetchNodeDetailsByIds.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useOntologyLabels(csd()));
    await waitFor(() => expect(fetchNodeDetailsByIds).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
