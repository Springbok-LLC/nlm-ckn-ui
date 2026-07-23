import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import { setGraphData } from "./graphSlice";

const initialState = {
  savedGraphs: [],
  activeGraphId: null,
  originHistory: [],
};

const savedGraphsSlice = createSlice({
  name: "savedGraphs",
  initialState,
  reducers: {
    saveGraph: (state, action) => {
      const { name, originNodeIds, settings, graphData, thumbnail } = action.payload;
      const newSavedGraph = {
        id: uuidv4(),
        name,
        timestamp: new Date().toISOString(),
        originNodeIds,
        settings,
        graphData,
        thumbnail: thumbnail ?? null,
      };
      state.savedGraphs.push(newSavedGraph);
      state.activeGraphId = newSavedGraph.id;
    },
    deleteGraph: (state, action) => {
      const idToDelete = action.payload;
      state.savedGraphs = state.savedGraphs.filter((g) => g.id !== idToDelete);
      if (state.activeGraphId === idToDelete) state.activeGraphId = null;
    },
    renameGraph: (state, action) => {
      const { id, name } = action.payload;
      const graph = state.savedGraphs.find((g) => g.id === id);
      if (graph) graph.name = name;
    },
    setActiveGraph: (state, action) => {
      state.activeGraphId = action.payload;
    },
    addHistoryEntry: (state, action) => {
      const entry = action.payload;
      // One entry per origin; re-adding an already-tracked origin is a no-op.
      if (state.originHistory.some((e) => e.originId === entry.originId)) return;
      state.originHistory.push({ checked: true, thumbnail: null, ...entry });
    },
    toggleHistoryEntry: (state, action) => {
      const e = state.originHistory.find((h) => h.id === action.payload);
      if (e) e.checked = !e.checked;
    },
    deleteHistoryEntry: (state, action) => {
      state.originHistory = state.originHistory.filter((h) => h.id !== action.payload);
    },
  },
});

export const {
  saveGraph,
  deleteGraph,
  renameGraph,
  setActiveGraph,
  addHistoryEntry,
  toggleHistoryEntry,
  deleteHistoryEntry,
} = savedGraphsSlice.actions;

// Stable empty reference so the fallback doesn't churn selector identity.
const EMPTY_SAVED_GRAPHS = [];

/**
 * Reads the saved-graph list, normalizing to an empty array. `savedGraphs` is
 * session-only, but a stale blob rehydrated from an older build can leave the
 * array undefined; every consumer goes through here so none of them crash on it.
 * @param {object} state
 * @returns {Array}
 */
export const selectSavedGraphs = (state) => state.savedGraphs.savedGraphs ?? EMPTY_SAVED_GRAPHS;

/**
 * Restores a saved graph into the live graph and marks it active.
 * @param {string} id
 */
export const restoreSavedGraph = (id) => (dispatch, getState) => {
  const graph = selectSavedGraphs(getState()).find((g) => g.id === id);
  if (!graph) return;
  dispatch(
    setGraphData({
      graphData: graph.graphData,
      originNodeIds: graph.originNodeIds,
      settings: graph.settings,
      isRestore: true,
      skipUndo: true,
    }),
  );
  dispatch(setActiveGraph(id));
};

/**
 * Snapshots the current live graph onto the shelf. No-op if the graph is empty.
 * @param {{ name?: string, thumbnail?: string|null }} [opts]
 */
export const snapshotCurrentGraph =
  ({ name = "Graph Title", thumbnail = null } = {}) =>
  (dispatch, getState) => {
    const present = getState().graph.present;
    const nodes = present?.graphData?.nodes ?? [];
    if (!nodes.length) return;
    dispatch(
      saveGraph({
        name,
        originNodeIds: present.originNodeIds ?? [],
        settings: present.settings ?? {},
        graphData: present.graphData,
        thumbnail,
      }),
    );
  };

const EMPTY_HISTORY = [];

/**
 * Reads the origin-history list, normalizing to an empty array. `originHistory`
 * is session-only.
 * @param {object} state
 * @returns {Array}
 */
export const selectOriginHistory = (state) => state.savedGraphs.originHistory ?? EMPTY_HISTORY;

/**
 * Merge the subgraphs of all checked history entries into one graph.
 * Dedupe nodes by _id (first-seen position wins), union links by a
 * source/target/label key. Pure — no store access.
 * @param {Array} history
 * @returns {{nodes: Array, links: Array}}
 */
export const mergeCheckedSubgraphs = (history) => {
  const nodes = new Map();
  const links = new Map();
  for (const entry of history) {
    if (!entry.checked) continue;
    for (const n of entry.subgraph?.nodes ?? []) {
      if (!nodes.has(n._id)) nodes.set(n._id, n);
    }
    for (const l of entry.subgraph?.links ?? []) {
      const s = typeof l.source === "object" ? (l.source._id ?? l.source.id) : l.source;
      const t = typeof l.target === "object" ? (l.target._id ?? l.target.id) : l.target;
      const key = `${s}->${t}:${l.label ?? ""}`;
      if (!links.has(key)) links.set(key, l);
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
};

/**
 * Rebuild the live graph from the currently-checked history entries, preserving
 * positions (no re-query, no re-simulation). Flags the render as a restore so
 * ForceGraph loads it in place.
 */
export const recomposeFromHistory = () => (dispatch, getState) => {
  const graphData = mergeCheckedSubgraphs(selectOriginHistory(getState()));
  dispatch(setGraphData({ graphData, isRestore: true, skipUndo: true }));
};

export default savedGraphsSlice.reducer;
