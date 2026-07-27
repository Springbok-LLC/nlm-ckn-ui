import { configureStore } from "@reduxjs/toolkit";
import graphReducer, { addOriginNode, removeOriginNode } from "./graphSlice";

// Mock the services the thunks call.
jest.mock("../services", () => ({
  fetchNodeExpansion: jest.fn(),
  fetchEdgesBetween: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchEdgeFilterOptions: jest.fn(),
}));

import { fetchEdgesBetween, fetchNodeExpansion } from "../services";

const node = (id) => ({ _id: id, label: id });
const link = (from, to) => ({ _id: `${from}->${to}`, _from: from, _to: to, _key: `${from}-${to}` });

function makeStore(preloadedPresent) {
  // graphReducer is undoable; seed the present slice via a store and dispatches.
  const store = configureStore({
    reducer: { graph: graphReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  if (preloadedPresent) {
    // Seed origin A already present (as if it were the first origin).
    store.dispatch({ type: "graph/__seed", ...preloadedPresent });
  }
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("addOriginNode stores the origin's subgraph, adds the id, and composes graphData", async () => {
  fetchNodeExpansion.mockResolvedValue({
    A: { nodes: [node("A"), node("N1")], links: [link("A", "N1")] },
  });
  fetchEdgesBetween.mockResolvedValue([]);

  const store = makeStore();
  await store.dispatch(addOriginNode("A"));

  const present = store.getState().graph.present;
  expect(present.originNodeIds).toEqual(["A"]);
  expect(present.originSubgraphs.A.nodes.map((n) => n._id).sort()).toEqual(["A", "N1"]);
  expect(present.graphData.nodes.map((n) => n._id).sort()).toEqual(["A", "N1"]);
  expect(present.lastActionType).toBe("recompose/add");
});

test("addOriginNode merges cross-origin edges from fetchEdgesBetween, deduped", async () => {
  fetchNodeExpansion.mockResolvedValue({
    B: { nodes: [node("B")], links: [] },
  });
  // Cross-origin edge B->A returned by the scan; A->N1 duplicate must not double.
  fetchEdgesBetween.mockResolvedValue([link("B", "A"), link("A", "N1")]);

  const store = makeStore();
  // First origin A.
  fetchNodeExpansion.mockResolvedValueOnce({
    A: { nodes: [node("A"), node("N1")], links: [link("A", "N1")] },
  });
  await store.dispatch(addOriginNode("A"));
  // Second origin B.
  fetchNodeExpansion.mockResolvedValueOnce({ B: { nodes: [node("B")], links: [] } });
  fetchEdgesBetween.mockResolvedValueOnce([link("B", "A"), link("A", "N1")]);
  await store.dispatch(addOriginNode("B"));

  const present = store.getState().graph.present;
  expect(present.originNodeIds).toEqual(["A", "B"]);
  const linkIds = present.graphData.links.map((l) => l._id).sort();
  expect(linkIds).toEqual(["A->N1", "B->A"]);
});

test("removeOriginNode drops the origin's unshared nodes and clears when last origin removed", async () => {
  fetchNodeExpansion
    .mockResolvedValueOnce({ A: { nodes: [node("A"), node("S")], links: [link("A", "S")] } })
    .mockResolvedValueOnce({ B: { nodes: [node("B"), node("S")], links: [link("B", "S")] } });
  fetchEdgesBetween.mockResolvedValue([]);

  const store = makeStore();
  await store.dispatch(addOriginNode("A"));
  await store.dispatch(addOriginNode("B"));

  // Remove B: A + shared S remain, B drops.
  await store.dispatch(removeOriginNode("B"));
  let present = store.getState().graph.present;
  expect(present.originNodeIds).toEqual(["A"]);
  expect(present.graphData.nodes.map((n) => n._id).sort()).toEqual(["A", "S"]);
  expect(present.lastActionType).toBe("recompose/remove");

  // Remove A (last origin): empty graph.
  await store.dispatch(removeOriginNode("A"));
  present = store.getState().graph.present;
  expect(present.originNodeIds).toEqual([]);
  expect(present.graphData).toEqual({ nodes: [], links: [] });
  expect(present.originSubgraphs).toEqual({});
});
