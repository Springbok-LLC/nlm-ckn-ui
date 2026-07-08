import { renderHook, waitFor } from "@testing-library/react";
import { useNodeDocument } from "./useNodeDocument";

jest.mock("services", () => ({
  fetchDocument: jest.fn(),
}));

import { fetchDocument } from "services";

describe("useNodeDocument", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns idle state for a null nodeId", () => {
    const { result } = renderHook(() => useNodeDocument(null));
    expect(result.current).toEqual({ document: null, loading: false, error: null });
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("fetches and returns the document for a COLL/key nodeId", async () => {
    fetchDocument.mockResolvedValue({ _id: "CS/abc", label: "Lung" });
    const { result } = renderHook(() => useNodeDocument("CS/abc"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchDocument).toHaveBeenCalledWith("CS", "abc");
    expect(result.current.document).toEqual({ _id: "CS/abc", label: "Lung" });
    expect(result.current.error).toBeNull();
  });

  it("serves a cached document without refetching", async () => {
    fetchDocument.mockResolvedValue({ _id: "CS/abc", label: "Lung" });
    const first = renderHook(() => useNodeDocument("CS/abc"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    fetchDocument.mockClear();
    const second = renderHook(() => useNodeDocument("CS/abc"));
    expect(second.result.current.document).toEqual({ _id: "CS/abc", label: "Lung" });
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("captures fetch errors", async () => {
    fetchDocument.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useNodeDocument("CS/err"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.document).toBeNull();
  });
});
