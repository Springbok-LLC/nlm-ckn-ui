import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import graphReducer, {
  loadGraph,
  setAvailableCollections,
  setGraphData,
} from "../../store/graphSlice";
import nodesReducer from "../../store/nodesSlice";
import savedGraphsReducer, {
  restoreHistoryEntry,
  selectOriginHistory,
  setActiveHistory,
} from "../../store/savedGraphsSlice";
import { ToastProvider } from "../Toast";
import ForceGraph from "./ForceGraph";
import { useGraphExport } from "./hooks";

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement the Blob URL APIs used by the graph export path
if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
}
if (!global.URL.revokeObjectURL) {
  global.URL.revokeObjectURL = jest.fn();
}

// Capture the onNodeClick callback so tests can trigger the popup directly
let capturedOnNodeClick = null;
// Capture the onSimulationEnd callback so tests can drive a settle directly
let capturedOnSimulationEnd = null;

const mockGraphInstance = {
  updateGraph: jest.fn(),
  setLayoutMode: jest.fn(),
  toggleLabels: jest.fn(),
  toggleSimulation: jest.fn(),
  toggleFocusNodes: jest.fn(),
  updateNodeFontSize: jest.fn(),
  updateLinkFontSize: jest.fn(),
  restoreGraph: jest.fn(),
  resize: jest.fn(),
  getCurrentGraph: jest.fn(() => null),
  isDragging: jest.fn(() => false),
};

jest.mock("components/ForceGraphConstructor/ForceGraphConstructor", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./hooks", () => {
  const actual = jest.requireActual("./hooks");
  return { ...actual, useGraphExport: jest.fn() };
});

// jsdom cannot rasterize SVG, so the real captureGraphThumbnail always rejects
// there. Mock it so history-capture tests get a deterministic, controllable
// thumbnail instead of a swallowed rejection.
jest.mock("utils", () => ({
  ...jest.requireActual("utils"),
  captureGraphThumbnail: jest.fn(() => Promise.resolve("mock-thumbnail")),
}));

const { captureGraphThumbnail } = require("utils");

const ForceGraphConstructorMock =
  require("components/ForceGraphConstructor/ForceGraphConstructor").default;

// Mock graph API services used by ForceGraph and its thunks
jest.mock("services", () => ({
  fetchNeighborCollections: jest.fn(),
  fetchNodeExpansion: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchCollections: jest.fn(() => Promise.resolve([])),
  fetchEdgeFilterOptions: jest.fn(() => Promise.resolve([])),
  fetchConnectingPaths: jest.fn(),
  fetchEdgesBetween: jest.fn(),
  fetchDocument: jest.fn(),
  fetchNodeDetailsByIds: jest.fn(),
  fetchNodesDetails: jest.fn(),
  executeAqlQuery: jest.fn(),
  fetchPredefinedQueries: jest.fn(),
  fetchCollectionDocuments: jest.fn(),
  searchDocuments: jest.fn(),
  fetchHierarchyData: jest.fn(),
  fetchWorkflowPresets: jest.fn(),
  ApiError: class ApiError extends Error {},
  fetchWithErrorHandling: jest.fn(),
  getJson: jest.fn(),
  postJson: jest.fn(),
}));

// Import mocked services after mock declaration for access in tests
const {
  fetchNeighborCollections,
  fetchNodeExpansion,
  fetchCollections,
  fetchEdgeFilterOptions,
} = require("services");

// Create a test store with all required slices
const createTestStore = () =>
  configureStore({
    reducer: {
      graph: graphReducer,
      nodesSlice: nodesReducer,
      savedGraphs: savedGraphsReducer,
    },
  });

// Create a store pre-populated with available collections so ForceGraphConstructor is created
const createStoreWithCollections = () => {
  const store = createTestStore();
  store.dispatch(setAvailableCollections(["CL", "UBERON", "GO"]));
  return store;
};

// Helper: render ForceGraph and open the popup for a node
const openNodePopup = async (store, nodeId = "CL/0000001") => {
  await act(async () => {
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ToastProvider>
            <ForceGraph />
          </ToastProvider>
        </MemoryRouter>
      </Provider>,
    );
  });
  // ForceGraphConstructor is called during effect above; capturedOnNodeClick is now set
  // Fire a fake node click to open the popup
  await act(async () => {
    if (capturedOnNodeClick) {
      capturedOnNodeClick({ clientX: 100, clientY: 100 }, { _id: nodeId, label: "Test Node" });
    }
  });
};

describe("ForceGraph", () => {
  beforeEach(() => {
    capturedOnNodeClick = null;
    capturedOnSimulationEnd = null;
    // Set up ForceGraphConstructor to capture callbacks and return the mock instance
    ForceGraphConstructorMock.mockImplementation((_svg, _data, opts) => {
      capturedOnNodeClick = opts.onNodeClick;
      capturedOnSimulationEnd = opts.onSimulationEnd;
      return mockGraphInstance;
    });
    // Reset mock call counts
    Object.values(mockGraphInstance).forEach((fn) => {
      if (fn.mockReset) fn.mockReset();
    });
    mockGraphInstance.getCurrentGraph.mockReturnValue(null);
    mockGraphInstance.isDragging.mockReturnValue(false);
    // Re-arm the export hook mock (resetMocks clears implementations between tests)
    useGraphExport.mockImplementation(() => jest.fn());
    // Default return values for service mocks
    fetchCollections.mockResolvedValue([]);
    fetchEdgeFilterOptions.mockResolvedValue([]);
    fetchNodeExpansion.mockResolvedValue({ nodes: [], links: [] });
    fetchNeighborCollections.mockResolvedValue([]);
    // Re-arm the thumbnail mock (resetMocks clears implementations between tests)
    captureGraphThumbnail.mockImplementation(() => Promise.resolve("mock-thumbnail"));
  });

  it("Should toggle options when toggle options button is clicked", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph title="Test Graph Title" />
      </Provider>,
    );

    // Get the button that toggles the options visibility
    // Button text is "Show Options" when closed, "Hide Options" when open
    const toggleButton = screen.getByRole("button", {
      name: /show options/i,
    });
    // Get the graph-options panel by its ID
    const optionsPanel = document.getElementById("graph-options-panel");

    // Ensure options begins hidden
    expect(optionsPanel).toHaveStyle("display: none");

    // Click button
    fireEvent.click(toggleButton);
    // After clicking, the options should be visible
    expect(optionsPanel).toHaveStyle("display: flex");

    // Click the toggle button again (now should say "Hide Options")
    const hideButton = screen.getByRole("button", {
      name: /hide options/i,
    });
    fireEvent.click(hideButton);
    // After clicking again, the options should be hidden
    expect(optionsPanel).toHaveStyle("display: none");
  });

  it("renders the graph title", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph title="Test Graph Title" />
      </Provider>,
    );

    expect(screen.getByRole("heading", { name: "Test Graph Title" })).toBeInTheDocument();
  });

  it("renders a download button on the canvas that triggers the export handler", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph title="Test Graph Title" />
      </Provider>,
    );

    const downloadButton = screen.getByRole("button", { name: /download graph/i });
    expect(downloadButton).toBeInTheDocument();

    const exportMock = useGraphExport.mock.results.at(-1).value;
    fireEvent.click(downloadButton);
    expect(exportMock).toHaveBeenCalledWith("png");
  });

  describe("Expand by Collection submenu", () => {
    it("shows the disclosure button when the node popup is open", async () => {
      fetchNeighborCollections.mockResolvedValue([]);
      const store = createStoreWithCollections();
      await openNodePopup(store);

      const disclosureBtn = screen.getByRole("button", {
        name: /expand by collection/i,
      });
      expect(disclosureBtn).toBeVisible();
      expect(disclosureBtn).toHaveAttribute("aria-haspopup", "menu");
      expect(disclosureBtn).toHaveAttribute("aria-expanded", "false");
    });

    it("populates the submenu with collection display labels after clicking the disclosure button", async () => {
      fetchNeighborCollections.mockResolvedValue(["CL", "UBERON"]);
      const store = createStoreWithCollections();
      await openNodePopup(store);

      const disclosureBtn = screen.getByRole("button", {
        name: /expand by collection/i,
      });

      await act(async () => {
        fireEvent.click(disclosureBtn);
      });

      await waitFor(() => {
        expect(screen.getByRole("menuitem", { name: /cell type/i })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /anatomical structure/i })).toBeInTheDocument();
      });

      expect(disclosureBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("triggers expandNode with collectionOverride when a collection item is clicked", async () => {
      fetchNeighborCollections.mockResolvedValue(["CL", "UBERON"]);
      fetchNodeExpansion.mockResolvedValue({ nodes: [], links: [] });
      const store = createStoreWithCollections();
      await openNodePopup(store, "GO/0000001");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /expand by collection/i }));
      });

      await waitFor(() =>
        expect(screen.queryByRole("menuitem", { name: /cell type/i })).toBeInTheDocument(),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /cell type/i }));
      });

      await waitFor(() => {
        // fetchNodeExpansion(nodeId, graphType, allowedCollections, includeInterNodeEdges, edgeFilters, excludeEdgeFilters)
        expect(fetchNodeExpansion).toHaveBeenCalledWith(
          "GO/0000001",
          expect.any(String),
          ["CL"],
          expect.any(Boolean),
          expect.any(Object),
          {},
        );
      });
    });

    it("forwards collapseNodes and collapseMode to updateGraph on workflow init", async () => {
      const store = createTestStore();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      const leafA = { _id: "GO/0010", id: "GO/0010" };
      const leafB = { _id: "GO/0020", id: "GO/0020" };
      await act(async () => {
        store.dispatch(setAvailableCollections(["CL", "GO"]));
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leafA, leafB],
              links: [
                { source: "CL/0001", target: "GO/0010" },
                { source: "CL/0001", target: "GO/0020" },
              ],
            },
            originNodeIds: [origin._id],
            source: "workflow",
            collapseLeafNodes: "all",
          }),
        );
      });
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await waitFor(() => expect(mockGraphInstance.updateGraph).toHaveBeenCalled());
      const firstCall = mockGraphInstance.updateGraph.mock.calls[0][0];
      expect(firstCall.collapseMode).toBe("all");
      expect(firstCall.collapseNodes).toEqual(expect.arrayContaining([leafA._id, leafB._id]));
      expect(firstCall.collapseNodes).not.toContain(origin._id);
    });

    it("routes a restore render through restoreGraph, not updateGraph", async () => {
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001", x: 10, y: 20 };
      const leaf = { _id: "GO/0010", id: "GO/0010", x: 30, y: 40 };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      mockGraphInstance.restoreGraph.mockClear();
      mockGraphInstance.updateGraph.mockClear();

      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            isRestore: true,
          }),
        );
      });

      await waitFor(() => expect(mockGraphInstance.restoreGraph).toHaveBeenCalled());
      expect(mockGraphInstance.updateGraph).not.toHaveBeenCalled();
    });

    it("auto-captures a history entry once when a new origin resolves, and not again on re-resolve or restore", async () => {
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      const leaf = { _id: "GO/0010", id: "GO/0010" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      // First resolution of a new origin: history should gain exactly one entry.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            originNodeIds: [origin._id],
          }),
        );
      });

      await waitFor(() => {
        const history = selectOriginHistory(store.getState());
        expect(history).toHaveLength(1);
        expect(history[0].originId).toBe(origin._id);
      });

      // Re-resolving the same origin must not add a duplicate entry.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            originNodeIds: [origin._id],
          }),
        );
      });

      await waitFor(() => {
        expect(selectOriginHistory(store.getState())).toHaveLength(1);
      });

      // A restore render must not spawn a new history entry.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            originNodeIds: [origin._id],
            isRestore: true,
          }),
        );
      });

      await waitFor(() => expect(mockGraphInstance.restoreGraph).toHaveBeenCalled());
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("freezes the active entry when a new origin is added, before the new entry exists", async () => {
      // Pin the actual mechanism under test: the origin-transition effect
      // writes `activeHistoryIdRef.current = null` directly, one line before
      // it dispatches setActiveHistory(null). The dispatch alone would
      // eventually null the ref too (via the separate mirror effect at
      // ForceGraph.js:162-165), but only after a further render — and
      // act()'s flush-until-stable behavior means a settle driven from a
      // *separate* act() call can never observe that gap, since by then the
      // mirror has already caught up regardless of the direct write. To
      // reach the actual gap the direct write exists to close, this
      // middleware calls the settle from *inside* the setActiveHistory(null)
      // dispatch, before its reducer (and therefore the store update the
      // mirror effect depends on) has run. At that instant, only the direct
      // ref write — not the dispatch — can have protected A.
      let interceptSettle = null;
      const freezeInterceptorMiddleware = () => (next) => (action) => {
        if (interceptSettle && action.type === setActiveHistory.type && action.payload === null) {
          const settle = interceptSettle;
          interceptSettle = null;
          settle();
        }
        return next(action);
      };
      const store = configureStore({
        reducer: {
          graph: graphReducer,
          nodesSlice: nodesReducer,
          savedGraphs: savedGraphsReducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(freezeInterceptorMiddleware),
      });
      store.dispatch(setAvailableCollections(["CL", "UBERON", "GO"]));

      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      captureGraphThumbnail.mockImplementationOnce(() => Promise.resolve("thumbnail-A"));
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryA = selectOriginHistory(store.getState())[0];
      expect(entryA.thumbnail).toBe("thumbnail-A");
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryA.id);

      // B's own capture is also held open, so its addHistoryEntry cannot
      // land (and re-point activeHistoryId) as a side channel either.
      let resolveThumbnailB;
      const thumbnailBPromise = new Promise((resolve) => {
        resolveThumbnailB = resolve;
      });
      captureGraphThumbnail.mockImplementationOnce(() => thumbnailBPromise);
      interceptSettle = () => capturedOnSimulationEnd([originA, originB], []);

      // Compose in a second origin. The freeze must happen synchronously with
      // the origin change, so a settle arriving before B's entry is created
      // cannot overwrite A's snapshot with the A+B graph.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA, originB], links: [] },
            originNodeIds: [originA._id, originB._id],
          }),
        );
      });

      expect(interceptSettle).toBeNull(); // confirms the settle actually fired mid-dispatch
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
      const afterFreeze = selectOriginHistory(store.getState()).find((e) => e.id === entryA.id);
      expect(afterFreeze.subgraph.nodes.map((n) => n._id)).toEqual([originA._id]);
      expect(afterFreeze.thumbnail).toBe("thumbnail-A");

      // Let B's capture resolve and its entry land.
      await act(async () => {
        resolveThumbnailB("thumbnail-B");
        await thumbnailBPromise;
      });

      // B still gets its own entry, and it becomes the active one.
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      const entryB = selectOriginHistory(store.getState())[1];
      expect(entryB.originId).toBe(originB._id);
      expect(entryB.thumbnail).toBe("thumbnail-B");
      expect(entryB.id).not.toBe(entryA.id);
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);
    });

    it("freezes and leaves nothing active when an origin is removed", async () => {
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA, originB], links: [] },
            originNodeIds: [originA._id, originB._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      const before = selectOriginHistory(store.getState());

      // Drop B. No new origin, so nothing becomes active and no card is added.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await act(async () => {
        capturedOnSimulationEnd([originA], []);
      });

      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      const after = selectOriginHistory(store.getState());
      expect(after).toHaveLength(2);
      expect(after.map((e) => e.subgraph.nodes.length)).toEqual(
        before.map((e) => e.subgraph.nodes.length),
      );
    });

    it("captures a second entry when an origin is removed and re-added", async () => {
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      const compose = async (nodes) => {
        await act(async () => {
          store.dispatch(
            setGraphData({
              graphData: { nodes, links: [] },
              originNodeIds: nodes.map((n) => n._id),
            }),
          );
        });
      };
      await compose([originA]);
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      await compose([originA, originB]);
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      await compose([originA]); // remove B — no capture
      await compose([originA, originB]); // re-add B — a second B card

      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(3));
      const history = selectOriginHistory(store.getState());
      expect(history.map((e) => e.originId)).toEqual([originA._id, originB._id, originB._id]);
      expect(new Set(history.map((e) => e.id)).size).toBe(3);
    });

    it("does not duplicate a history entry when ForceGraph remounts with an origin already covered by history", async () => {
      // graph/savedGraphs state survives route changes (only nodesSlice is
      // persistence-whitelisted), so leaving /graph and returning remounts
      // ForceGraph while the store still holds live graphData and a history
      // entry for that origin. The first-run branch must not re-queue it —
      // otherwise, since Task 1 removed the reducer's originId dedupe, it
      // would append a duplicate card for a graph that already has one.
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      let unmount;
      await act(async () => {
        ({ unmount } = render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        ));
      });
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [origin], links: [] }, originNodeIds: [origin._id] }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));

      unmount();

      // Remount into the same store — graphData and originNodeIds are still
      // live from before the unmount, exactly as GraphWorkspace/ForceGraph
      // remounting on a return to /graph would see.
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("clears a stale pending origin on restore so a coincidental id match cannot hijack the restored entry", async () => {
      // A fresh search sets originNodeIds before its data arrives, leaving an
      // origin pending. If that origin id happens to also appear in a graph
      // delivered later by a restore, and the pending queue is not cleared,
      // the next ungated effect run captures it as a phantom entry and steals
      // activeHistoryId away from the entry the restore just activated.
      const store = createStoreWithCollections();
      const originB = { _id: "CL/0002", id: "CL/0002" };
      // Shares an id with the origin left pending below.
      const sharedNode = { _id: "CL/0001", id: "CL/0001" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      // Resolve and capture origin B normally.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originB, sharedNode], links: [] },
            originNodeIds: [originB._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryB = selectOriginHistory(store.getState())[0];
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);

      // A fresh search sets originNodeIds before its data arrives, leaving
      // this origin pending indefinitely (graphData has no matching node yet).
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [], links: [] }, originNodeIds: [sharedNode._id] }),
        );
      });

      // Before that search resolves, the user restores entry B.
      await act(async () => {
        store.dispatch(restoreHistoryEntry(entryB.id));
      });
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);

      // The settle that follows the restore delivers entryB's subgraph, which
      // happens to contain a node sharing an id with the still-pending origin.
      await act(async () => {
        capturedOnSimulationEnd([originB, sharedNode], []);
      });

      // No phantom entry was captured, and the restored entry is still active.
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);
    });

    it("keeps a restored entry active and syncing", async () => {
      // A restore clears originNodeIds, which must not read as an origin-set
      // change — otherwise it would freeze the entry the restore just activated.
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001", x: 1, y: 1 };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [origin], links: [] }, originNodeIds: [origin._id] }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryId = selectOriginHistory(store.getState())[0].id;

      await act(async () => {
        store.dispatch(restoreHistoryEntry(entryId));
      });
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryId);

      // A settle after the restore still updates that entry.
      const moved = { ...origin, x: 99, y: 99 };
      await act(async () => {
        capturedOnSimulationEnd([moved], []);
      });
      await waitFor(() => {
        const restored = selectOriginHistory(store.getState()).find((e) => e.id === entryId);
        expect(restored.subgraph.nodes[0].x).toBe(99);
      });
    });

    it("freezes the active entry and clears activeHistoryId when a saved graph is loaded, adding no new card", async () => {
      // Unlike a restore, loading a saved graph never re-points activeHistoryId,
      // so the previously active entry must freeze here or the settle that
      // follows the load would stamp the loaded graph into it.
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [origin], links: [] }, originNodeIds: [origin._id] }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryA = selectOriginHistory(store.getState())[0];
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryA.id);

      const loaded = { _id: "CL/0099", id: "CL/0099" };
      await act(async () => {
        store.dispatch(
          loadGraph({
            originNodeIds: [loaded._id],
            settings: store.getState().graph.present.settings,
            graphData: { nodes: [loaded], links: [] },
          }),
        );
      });

      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      expect(selectOriginHistory(store.getState())).toHaveLength(1);

      // A settle following the load must not resurrect or overwrite A's entry.
      await act(async () => {
        capturedOnSimulationEnd([loaded], []);
      });

      const afterLoad = selectOriginHistory(store.getState()).find((e) => e.id === entryA.id);
      expect(afterLoad.subgraph.nodes.map((n) => n._id)).toEqual([origin._id]);
      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("does not show an error state when popup is closed before the fetch resolves (abort)", async () => {
      let resolveCollections;
      const deferred = new Promise((resolve) => {
        resolveCollections = resolve;
      });
      fetchNeighborCollections.mockReturnValue(deferred);

      const store = createStoreWithCollections();
      await openNodePopup(store);

      // Click the disclosure to start the fetch
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /expand by collection/i }));
      });

      // Close the popup before the fetch resolves
      await act(async () => {
        const closeBtn = screen.getByRole("button", { name: /close popup/i });
        fireEvent.click(closeBtn);
      });

      // Now resolve the deferred promise
      await act(async () => {
        resolveCollections(["CL", "UBERON"]);
        await deferred;
      });

      // Popup is closed and no error state should appear
      expect(screen.queryByText(/failed to load collections/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    });
  });
});
