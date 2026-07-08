import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";

const initialState = {
  savedGraphs: [],
  activeGraphId: null,
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
  },
});

export const { saveGraph, deleteGraph, renameGraph, setActiveGraph } = savedGraphsSlice.actions;

export default savedGraphsSlice.reducer;
