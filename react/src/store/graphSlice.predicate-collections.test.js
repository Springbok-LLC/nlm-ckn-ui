import { configureStore } from "@reduxjs/toolkit";

// The edge-filter-options response can carry a reserved `_`-prefixed key
// (e.g. `_predicateCollections`, added by the backend in D2). It must never
// reach `availableEdgeFilters` or get seeded into `settings.edgeFilters` --
// `services/api/graph.js` ships `edge_filters` from settings, so a stray key
// there would end up in request bodies, not merely on screen.
jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchNodeExpansion: jest.fn(),
}));

const slice = require("./graphSlice");
const { default: graphReducer, fetchEdgeFilterOptions } = slice;

const makeStore = () => configureStore({ reducer: { graph: graphReducer } });
const present = (store) => store.getState().graph.present;

describe("edge filter options reserved key tolerance", () => {
  const payload = {
    Label: { type: "categorical", values: ["PRODUCES"] },
    _predicateCollections: { PRODUCES: ["GS", "PR"] },
  };

  it("strips the reserved key from availableEdgeFilters", () => {
    const store = makeStore();
    store.dispatch(fetchEdgeFilterOptions.fulfilled(payload, "reqId", ["Label"]));
    expect(present(store).availableEdgeFilters).toEqual({
      Label: { type: "categorical", values: ["PRODUCES"] },
    });
    expect(present(store).availableEdgeFilters).not.toHaveProperty("_predicateCollections");
  });

  it("does not seed the reserved key into settings.edgeFilters", () => {
    const store = makeStore();
    store.dispatch(fetchEdgeFilterOptions.fulfilled(payload, "reqId", ["Label"]));
    expect(present(store).settings.edgeFilters).toHaveProperty("Label");
    expect(present(store).settings.edgeFilters).not.toHaveProperty("_predicateCollections");
  });
});

describe("restored settings are sanitized too", () => {
  // Guarding only the response is not enough. A saved graph persists the whole
  // settings blob, and the frontend and backend deploy as separate CI jobs, so
  // a blob captured during a skew window could carry the reserved key and
  // reintroduce it into request bodies long after the response itself is clean.
  const poisoned = {
    edgeFilters: { Label: ["PRODUCES"], _predicateCollections: { PRODUCES: ["GS", "PR"] } },
  };

  it("strips the reserved key when loadGraph restores a saved graph", () => {
    const store = makeStore();
    store.dispatch(
      slice.loadGraph({
        originNodeIds: ["CS/a"],
        settings: poisoned,
        graphData: { nodes: [], links: [] },
      }),
    );
    expect(present(store).settings.edgeFilters).toHaveProperty("Label");
    expect(present(store).settings.edgeFilters).not.toHaveProperty("_predicateCollections");
  });

  it("strips the reserved key when setGraphData restores settings", () => {
    const store = makeStore();
    store.dispatch(
      slice.setGraphData({
        graphData: { nodes: [], links: [] },
        originNodeIds: ["CS/a"],
        settings: poisoned,
      }),
    );
    expect(present(store).settings.edgeFilters).not.toHaveProperty("_predicateCollections");
  });
});
