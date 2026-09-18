import AddToGraphButton from "components/AddToGraphButton";
import DocumentPopup from "components/DocumentPopup";
import SunburstConstructor from "components/SunburstConstructor";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHierarchyData } from "services";
import { getLabel, LoadingBar, mergeChildren } from "utils";

const PREFETCH_CONCURRENCY = 4;
const PREFETCH_SKIP_PREFIXES = ["CL/", "GS/", "MONDO/", "PR/", "CHEMBL/"];

/**
 * Sunburst hierarchy view.
 *
 * @param {function} [addSelectedItem] - Adds the popup's clicked node as a graph origin.
 * @param {string} [label] - The edge predicate the hierarchy follows.
 * @param {object} [data] - Hierarchy data to render. When omitted, Sunburst fetches its own root.
 * @param {function} [fetchChildren] - Async callback(nodeId) returning that node's children.
 * @param {Array<string>} [focusPath] - Root-to-node id path naming the node to center on.
 * @param {function} [onFocusChange] - Called with the new focus path when the user re-centers.
 */
const Sunburst = ({
  addSelectedItem,
  label = "SUB_CLASS_OF",
  data,
  fetchChildren,
  focusPath,
  onFocusChange,
}) => {
  const isControlledData = data !== undefined;
  const [ownGraphData, setOwnGraphData] = useState(null);
  const graphData = isControlledData ? data : ownGraphData;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [clickedItem, setClickedItem] = useState(null);
  const [popupVisible, setPopupVisible] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  // Lazily seeded from focusPath so the very first mount (e.g. after
  // switching from the tree) centers on the right node without a re-render.
  const [zoomedNodeId, setZoomedNodeId] = useState(() => {
    if (focusPath === undefined || focusPath.length === 0) return null;
    const focusedId = focusPath[focusPath.length - 1];
    return focusedId && focusedId !== data?._id ? focusedId : null;
  });
  const prevControlledRootIdRef = useRef(data?._id);

  const svgContainerRef = useRef(null);
  const svgNodeRef = useRef(null);
  const popupRef = useRef(null);
  const currentHierarchyRootRef = useRef(null);
  const isLoadingRef = useRef(isLoading);
  const isInitialMountRef = useRef(true);

  const d3ClickedRef = useRef(null);
  const handleNodeClickRef = useRef(null);
  const handleCenterClickRef = useRef(null);
  const handleSunburstClickRef = useRef(null);

  // Mount-once refs for the d3 update function
  const updateRef = useRef(null);
  const bloomInRef = useRef(null);
  const mountedRef = useRef(false);
  const justMountedRef = useRef(false); // skip update effect on the mount render

  const shouldBloomRef = useRef(false);

  // Prefetch state
  const prefetchInFlightRef = useRef(new Set());
  const prefetchFetchedRef = useRef(new Set());
  const prefetchGenerationRef = useRef(0);

  // Debounce queue: accumulate merges, flush once per rAF
  const mergeQueueRef = useRef([]);
  const rafIdRef = useRef(null);

  // --- Debounced merge: batches multiple prefetch results into one setState ---
  // Only used for the uncontrolled prefetch path; a controlled `data` prop
  // already carries every merge its owner performs.
  const flushMergeQueue = useCallback(() => {
    rafIdRef.current = null;
    const queue = mergeQueueRef.current;
    if (queue.length === 0 || isControlledData) return;
    mergeQueueRef.current = [];
    setOwnGraphData((prev) => {
      if (!prev) return prev;
      let result = prev;
      for (const { parentId, data: children } of queue) {
        result = mergeChildren(result, parentId, children);
      }
      return result;
    });
  }, [isControlledData]);

  const scheduleMerge = useCallback(
    (parentId, data) => {
      mergeQueueRef.current.push({ parentId, data });
      if (rafIdRef.current == null) {
        rafIdRef.current = requestAnimationFrame(flushMergeQueue);
      }
    },
    [flushMergeQueue],
  );

  // --- Fetch this component's own root (uncontrolled path only) ---
  const fetchRootData = useCallback(async () => {
    if (isLoadingRef.current) return;
    setIsLoading(true);
    isLoadingRef.current = true;
    setError(null);
    try {
      const rootData = await fetchHierarchyData(label, null);
      if (typeof rootData !== "object" || rootData === null || Array.isArray(rootData))
        throw new Error("API error for initial load/root");
      prefetchGenerationRef.current += 1;
      prefetchInFlightRef.current = new Set();
      prefetchFetchedRef.current = new Set();
      mergeQueueRef.current = [];
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setOwnGraphData(rootData);
      setZoomedNodeId(null);
      currentHierarchyRootRef.current = null;
    } catch (err) {
      console.error("Fetch/Process Error:", err);
      setError(err.message);
      setOwnGraphData(null);
      setZoomedNodeId(null);
      currentHierarchyRootRef.current = null;
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [label]);

  // --- Fetch one node's children, via the caller's fetchChildren when the
  // component is controlled, falling back to its own fetch otherwise. ---
  const fetchNodeChildren = useCallback(
    async (parentId) => {
      const result = await fetchHierarchyData(label, parentId);
      if (!Array.isArray(result)) throw new Error(`API error for parent ${parentId}`);
      return result;
    },
    [label],
  );

  const loadNodeChildren = useCallback(
    async (parentId) => {
      if (isLoadingRef.current) return;
      setIsLoading(true);
      isLoadingRef.current = true;
      setError(null);
      try {
        const loadChildren = fetchChildren ?? fetchNodeChildren;
        const children = await loadChildren(parentId);
        if (!Array.isArray(children)) throw new Error(`API error for parent ${parentId}`);
        prefetchFetchedRef.current.add(parentId);
        if (!isControlledData) {
          setOwnGraphData((prev) => (prev ? mergeChildren(prev, parentId, children) : prev));
        }
      } catch (err) {
        console.error("Fetch/Process Error:", err);
        setError(err.message);
      } finally {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
    },
    [fetchChildren, fetchNodeChildren, isControlledData],
  );

  // --- Background prefetch (silent, no loading bar; uncontrolled path only,
  // since a controlled `data` prop's fetching is entirely its owner's call) ---
  const prefetchNode = useCallback(
    async (parentId, generation) => {
      if (prefetchInFlightRef.current.has(parentId)) return;
      prefetchInFlightRef.current.add(parentId);
      try {
        const children = await fetchHierarchyData(label, parentId);
        if (generation !== prefetchGenerationRef.current) return;
        if (!Array.isArray(children)) return;
        prefetchFetchedRef.current.add(parentId);
        scheduleMerge(parentId, children);
      } catch (err) {
        console.debug(`Prefetch failed for ${parentId}:`, err);
      } finally {
        prefetchInFlightRef.current.delete(parentId);
      }
    },
    [label, scheduleMerge],
  );

  const collectUnfetchedIds = useCallback((node, ids) => {
    if (!node) return;
    const id = node._id;
    if (id && PREFETCH_SKIP_PREFIXES.some((p) => id.startsWith(p))) return;
    if (
      node._hasChildren &&
      !node.children &&
      id &&
      !prefetchFetchedRef.current.has(id) &&
      !prefetchInFlightRef.current.has(id)
    ) {
      ids.push(id);
    }
    if (node.children) {
      for (const child of node.children) collectUnfetchedIds(child, ids);
    }
  }, []);

  // Drive prefetch on graphData changes
  useEffect(() => {
    if (!graphData || isControlledData) return;
    const generation = prefetchGenerationRef.current;
    const ids = [];
    collectUnfetchedIds(graphData, ids);
    const free = PREFETCH_CONCURRENCY - prefetchInFlightRef.current.size;
    for (let i = 0; i < ids.length && i < free; i++) {
      prefetchNode(ids[i], generation);
    }
  }, [graphData, isControlledData, collectUnfetchedIds, prefetchNode]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    return () => {
      prefetchGenerationRef.current += 1;
    };
  }, []);

  // Initial data fetch on mount (uncontrolled path only)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - only run on mount
  useEffect(() => {
    if (!isControlledData && !graphData && !isLoadingRef.current) fetchRootData();
  }, []);

  // Re-derive focus when a controlled root actually changes identity (a new
  // label was picked upstream); same-label focus changes are already
  // reflected by the click handlers below, so this only resets on that edge.
  useEffect(() => {
    if (!isControlledData) return;
    if (prevControlledRootIdRef.current === data?._id) return;
    prevControlledRootIdRef.current = data?._id;
    setZoomedNodeId(null);
    currentHierarchyRootRef.current = null;
  }, [isControlledData, data?._id]);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (isControlledData) return;
    setOwnGraphData(null);
    setZoomedNodeId(null);
    currentHierarchyRootRef.current = null;
    setClickedItem(null);
    setPopupVisible(false);
    fetchRootData();
  }, [fetchRootData, isControlledData]);

  // --- Needs-load check ---
  const checkNeedsLoad = useCallback((d) => {
    if (!d) return false;
    if (d.data._hasChildren) {
      if (!d.children) return true;
      for (const child of d.children) {
        if (child.data._hasChildren && !child.children) return true;
      }
    }
    return false;
  }, []);

  // --- Report the focused node up as a root-to-node id path; `null` means
  // "back to the root". Ancestors come from the clicked d3 node itself, so
  // the path names the exact DAG occurrence the user is looking at. ---
  const reportFocus = useCallback(
    (d3Node) => {
      if (!onFocusChange) return;
      if (!d3Node) {
        onFocusChange(graphData?._id ? [graphData._id] : []);
        return;
      }
      onFocusChange(
        d3Node
          .ancestors()
          .reverse()
          .map((ancestor) => ancestor.data._id),
      );
    },
    [onFocusChange, graphData],
  );

  // --- Click handlers ---
  const latestHandleNodeClick = useCallback(
    (_event, d3Node) => {
      if (!d3Node.data._hasChildren) return false;
      const currentIsLoading = isLoadingRef.current;
      if (currentIsLoading) return false;

      // Normal navigation within the drilled-down chart
      const needsLoad = checkNeedsLoad(d3Node);
      if (d3Node.data._id === zoomedNodeId && !needsLoad) return false;
      if (needsLoad && !currentIsLoading) {
        if (zoomedNodeId !== d3Node.data._id) setZoomedNodeId(d3Node.data._id);
        reportFocus(d3Node);
        loadNodeChildren(d3Node.data._id);
        return true;
      }
      if (!needsLoad && d3Node.children) {
        if (zoomedNodeId !== d3Node.data._id) setZoomedNodeId(d3Node.data._id);
        reportFocus(d3Node);
        return true;
      }
      return false;
    },
    [checkNeedsLoad, loadNodeChildren, reportFocus, zoomedNodeId],
  );

  const latestHandleCenterClick = useCallback(() => {
    const currentHierarchy = currentHierarchyRootRef.current;
    const currentCenterId = zoomedNodeId;
    const currentIsLoading = isLoadingRef.current;
    if (!currentHierarchy) return;

    let centeredNode;
    if (currentCenterId) {
      centeredNode = currentHierarchy.find((node) => node.data._id === currentCenterId);
    } else {
      centeredNode = currentHierarchy.find((node) => node.depth === 0);
    }

    if (!centeredNode) {
      const absoluteRoot = currentHierarchy.find((d) => d.depth === 0);
      if (absoluteRoot) {
        if (zoomedNodeId !== null) setZoomedNodeId(null);
        if (d3ClickedRef.current) d3ClickedRef.current(null, absoluteRoot);
        reportFocus(null);
      }
      return;
    }
    const parentNode = centeredNode.parent;
    if (parentNode) {
      const newZoomTargetId = parentNode.depth === 0 ? null : parentNode.data._id;
      if (zoomedNodeId !== newZoomTargetId) setZoomedNodeId(newZoomTargetId);
      if (d3ClickedRef.current) d3ClickedRef.current(null, parentNode);
      reportFocus(parentNode.depth === 0 ? null : parentNode);
      const needsLoadForParent = checkNeedsLoad(parentNode);
      if (
        needsLoadForParent &&
        !currentIsLoading &&
        parentNode.data?._id &&
        parentNode.depth !== 0
      ) {
        loadNodeChildren(parentNode.data._id);
      }
    } else {
      if (zoomedNodeId !== null) setZoomedNodeId(null);
      if (d3ClickedRef.current && centeredNode) d3ClickedRef.current(null, centeredNode);
      reportFocus(null);
    }
  }, [checkNeedsLoad, zoomedNodeId, loadNodeChildren, reportFocus]);

  const latestHandleSunburstClick = useCallback((e, dataNode) => {
    setClickedItem(dataNode.data);
    setPopupPosition({ x: e.clientX + 10 + window.scrollX, y: e.clientY + 10 + window.scrollY });
    setPopupVisible(true);
  }, []);

  useEffect(() => {
    handleNodeClickRef.current = latestHandleNodeClick;
    handleCenterClickRef.current = latestHandleCenterClick;
    handleSunburstClickRef.current = latestHandleSunburstClick;
  }, [latestHandleNodeClick, latestHandleCenterClick, latestHandleSunburstClick]);

  // --- MOUNT EFFECT: build SVG once ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers come from refs; only re-mount on graphData
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container || !graphData || mountedRef.current) return;

    const sunburstInstance = SunburstConstructor(
      graphData,
      928,
      handleSunburstClickRef,
      handleNodeClickRef,
      handleCenterClickRef,
      zoomedNodeId,
    );

    if (sunburstInstance.svgNode) {
      svgNodeRef.current = sunburstInstance.svgNode;
      container.appendChild(svgNodeRef.current);
      currentHierarchyRootRef.current = sunburstInstance.hierarchyRoot;
      d3ClickedRef.current = sunburstInstance.d3Clicked;
      updateRef.current = sunburstInstance.update;
      bloomInRef.current = sunburstInstance.bloomIn;
      mountedRef.current = true;

      justMountedRef.current = true; // prevent update effect from firing this cycle

      if (bloomInRef.current) {
        bloomInRef.current(400);
      }
    }

    return () => {
      if (svgNodeRef.current && container.contains(svgNodeRef.current)) {
        container.removeChild(svgNodeRef.current);
      }
      svgNodeRef.current = null;
      currentHierarchyRootRef.current = null;
      d3ClickedRef.current = null;
      updateRef.current = null;
      bloomInRef.current = null;
      mountedRef.current = false;
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [graphData]);

  // --- UPDATE EFFECT: patch existing SVG when data changes ---
  useEffect(() => {
    if (justMountedRef.current) {
      justMountedRef.current = false;
      return; // skip — mount effect already handled this render
    }
    if (!mountedRef.current || !updateRef.current || !graphData) return;
    const newRoot = updateRef.current(graphData, zoomedNodeId);
    // Re-expose the current hierarchy root after data-join rebuild.
    // update() now returns the rebuilt root directly so we don't have to
    // fish it out of DOM-bound data (which includes fading-out exit nodes
    // that still carry the OLD hierarchy).
    if (newRoot) {
      currentHierarchyRootRef.current = newRoot;
    }
  }, [graphData]);

  // --- Popup ---
  const handlePopupClose = useCallback(() => {
    setPopupVisible(false);
    setClickedItem(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) handlePopupClose();
    };
    if (popupVisible) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popupVisible, handlePopupClose]);

  function _handleSelectItem() {
    if (clickedItem) addSelectedItem(clickedItem);
    handlePopupClose();
  }

  return (
    <div className="sunburst-component-wrapper">
      {error && (
        <div className="sunburst-error-banner" role="alert">
          <span className="sunburst-error-banner-message">Error: {error}</span>
          <button
            type="button"
            className="sunburst-error-banner-dismiss"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}
      {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
      <div
        data-testid="sunburst-container"
        id="sunburst-container"
        ref={svgContainerRef}
        className="sunburst-svg-container"
        style={{
          position: "relative",
          minHeight: "600px",
          width: "100%",
          maxWidth: "928px",
          margin: "0 auto",
        }}
      >
        {isLoading && <LoadingBar />}
      </div>

      {popupVisible && clickedItem && (
        <DocumentPopup isVisible={popupVisible} position={popupPosition} onClose={handlePopupClose}>
          {clickedItem && (
            <>
              <p
                style={{
                  margin: "0 0 5px 0",
                  fontWeight: "bold",
                  borderBottom: "1px solid #ccc",
                  paddingBottom: "3px",
                }}
              >
                {getLabel(clickedItem)}
              </p>
              <a
                className="document-popup-button"
                href={`/#/collections/${clickedItem._id}`}
                rel="noopener noreferrer"
              >
                Go To Page
              </a>
              <AddToGraphButton nodeId={clickedItem._id} text="Add as origin" />
            </>
          )}
        </DocumentPopup>
      )}
    </div>
  );
};

export default Sunburst;
