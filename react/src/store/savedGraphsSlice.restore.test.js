import { configureStore } from "@reduxjs/toolkit";
import graphReducer from "./graphSlice";
import savedGraphsReducer, {
  deleteGraph,
  renameGraph,
  restoreSavedGraph,
  saveGraph,
  setActiveGraph,
} from "./savedGraphsSlice";

const makeStore = () => configureStore({ reducer: { savedGraphs: savedGraphsReducer } });
const makeFullStore = () =>
  configureStore({ reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer } });
const state = (s) => s.getState().savedGraphs;

describe("savedGraphsSlice extensions", () => {
  it("saveGraph stores thumbnail and marks the new graph active", () => {
    const store = makeStore();
    store.dispatch(
      saveGraph({
        name: "G1",
        originNodeIds: ["CS/a"],
        settings: {},
        graphData: {},
        thumbnail: "data:x",
      }),
    );
    const { savedGraphs, activeGraphId } = state(store);
    expect(savedGraphs).toHaveLength(1);
    expect(savedGraphs[0].thumbnail).toBe("data:x");
    expect(activeGraphId).toBe(savedGraphs[0].id);
  });

  it("renameGraph updates the name by id", () => {
    const store = makeStore();
    store.dispatch(saveGraph({ name: "G1", originNodeIds: [], settings: {}, graphData: {} }));
    const id = state(store).savedGraphs[0].id;
    store.dispatch(renameGraph({ id, name: "Renamed" }));
    expect(state(store).savedGraphs[0].name).toBe("Renamed");
  });

  it("setActiveGraph sets the active id", () => {
    const store = makeStore();
    store.dispatch(setActiveGraph("xyz"));
    expect(state(store).activeGraphId).toBe("xyz");
  });

  it("deleteGraph clears activeGraphId when the active graph is removed", () => {
    const store = makeStore();
    store.dispatch(saveGraph({ name: "G1", originNodeIds: [], settings: {}, graphData: {} }));
    const id = state(store).savedGraphs[0].id;
    store.dispatch(setActiveGraph(id));
    store.dispatch(deleteGraph(id));
    expect(state(store).activeGraphId).toBeNull();
  });
});

describe("restoreSavedGraph thunk", () => {
  it("loads the saved graph's data and marks it active", () => {
    const store = makeFullStore();
    store.dispatch(
      saveGraph({
        name: "G1",
        originNodeIds: ["CS/a"],
        settings: {},
        graphData: { nodes: [{ id: "CS/a" }], links: [] },
      }),
    );
    const id = store.getState().savedGraphs.savedGraphs[0].id;
    store.dispatch(restoreSavedGraph(id));
    expect(store.getState().savedGraphs.activeGraphId).toBe(id);
    expect(store.getState().graph.present.graphData.nodes).toEqual([{ id: "CS/a" }]);
  });

  it("is a no-op for an unknown id", () => {
    const store = makeFullStore();
    expect(() => store.dispatch(restoreSavedGraph("nope"))).not.toThrow();
  });
});
