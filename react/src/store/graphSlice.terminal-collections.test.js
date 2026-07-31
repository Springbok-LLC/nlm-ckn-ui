import { configureStore } from "@reduxjs/toolkit";

const mockFetchNodeExpansion = jest.fn();
const mockFetchGraphData = jest.fn();
jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: (...args) => mockFetchGraphData(...args),
  fetchNodeExpansion: (...args) => mockFetchNodeExpansion(...args),
}));

const slice = require("./graphSlice");
const { default: graphReducer, updateSetting, expandNode, fetchAndProcessGraph } = slice;

const makeStore = () => configureStore({ reducer: { graph: graphReducer } });
const present = (store) => store.getState().graph.present;

describe("terminal collections", () => {
  beforeEach(() => {
    mockFetchNodeExpansion.mockClear();
    mockFetchGraphData.mockClear();
  });

  it("defaults to an empty list", () => {
    const store = makeStore();
    expect(present(store).settings.terminalCollections).toEqual([]);
  });

  it("sends terminalCollections on a normal traversal", async () => {
    mockFetchGraphData.mockResolvedValue({});
    const store = makeStore();
    store.dispatch(updateSetting({ setting: "terminalCollections", value: ["UBERON", "CSD"] }));

    await store.dispatch(fetchAndProcessGraph());

    expect(mockFetchGraphData).toHaveBeenCalledWith(
      expect.objectContaining({ terminalCollections: ["UBERON", "CSD"] }),
    );
  });

  it("forwards terminalCollections on node expansion", async () => {
    mockFetchNodeExpansion.mockResolvedValue({ "UBERON/0001004": { nodes: [], links: [] } });
    const store = makeStore();
    store.dispatch(updateSetting({ setting: "terminalCollections", value: ["UBERON"] }));

    await store.dispatch(expandNode({ nodeId: "UBERON/0001004" }));

    // Expanding a terminal node is NOT a no-op: PRUNE never evaluates the
    // traversal start, and at depth 1 there is no descent to stop. Guard this
    // so nobody "fixes" it later by bypassing the setting on expansion.
    expect(mockFetchNodeExpansion).toHaveBeenCalled();
    const args = mockFetchNodeExpansion.mock.calls[0];
    expect(args).toContainEqual(["UBERON"]);
  });

  it("sends an empty list rather than null when unset", async () => {
    mockFetchGraphData.mockResolvedValue({});
    const store = makeStore();

    await store.dispatch(fetchAndProcessGraph());

    const params = mockFetchGraphData.mock.calls[0][0];
    expect(params.terminalCollections).toEqual([]);
    expect(params.terminalCollections).not.toBeNull();
  });
});
