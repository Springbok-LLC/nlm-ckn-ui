import { act, renderHook, waitFor } from "@testing-library/react";
import { useSearch } from "./useSearch";

jest.mock("services", () => ({ searchDocuments: jest.fn(), fetchDocument: jest.fn() }));

import { fetchDocument, searchDocuments } from "services";

jest.useFakeTimers();

const runSearch = async (query) => {
  const { result } = renderHook(() => useSearch("phenotypes"));
  act(() => result.current.setQuery(query));
  await act(async () => jest.advanceTimersByTime(250));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
};

describe("useSearch", () => {
  beforeEach(() => jest.clearAllMocks());

  it("prepends the resolved identifier document ahead of the search results", async () => {
    searchDocuments.mockResolvedValue([{ _id: "UBERON/0002406", label: "trachea" }]);
    fetchDocument.mockResolvedValue({ _id: "UBERON/0002405", label: "lung" });

    const result = await runSearch("UBERON:0002405");

    expect(result.current.results.map((r) => r._id)).toEqual(["UBERON/0002405", "UBERON/0002406"]);
    expect(fetchDocument).toHaveBeenCalledWith("UBERON", "0002405", {
      silent: true,
      fallback: null,
    });
  });

  it("does not duplicate a resolved document already present in the search results", async () => {
    const doc = { _id: "UBERON/0002405", label: "lung" };
    searchDocuments.mockResolvedValue([doc]);
    fetchDocument.mockResolvedValue(doc);

    const result = await runSearch("UBERON:0002405");

    expect(result.current.results.map((r) => r._id)).toEqual(["UBERON/0002405"]);
  });

  it("never calls fetchDocument for a plain-text query", async () => {
    searchDocuments.mockResolvedValue([{ _id: "CL/0000540", label: "neuron" }]);

    const result = await runSearch("neuron");

    expect(fetchDocument).not.toHaveBeenCalled();
    expect(result.current.results.map((r) => r._id)).toEqual(["CL/0000540"]);
  });

  it("leaves search results untouched when the identifier lookup misses", async () => {
    searchDocuments.mockResolvedValue([]);
    fetchDocument.mockResolvedValue(null);

    const result = await runSearch("UBERON:9999999");

    expect(result.current.results).toEqual([]);
  });
});
