import Sunburst from "components/Sunburst";
import Tree from "components/Tree";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchHierarchyData, fetchHierarchyLabels } from "services";
import { LoadingBar, mergeChildren } from "utils";
import BrowseToolbar from "./BrowseToolbar";

const VIEWS = ["sunburst", "tree"];

// Every ancestor's own root-to-node path, root first, focused node last --
// what TreeConstructor's `expandedPaths` needs so each ancestor along the
// focus chain shows its children (including the focused node's own).
const prefixesOf = (path) => path.map((_, index) => path.slice(0, index + 1));

/**
 * Browse: one page hosting the sunburst and tree views over the same CL
 * hierarchy data, so toggling between them is free -- no refetch, and the
 * view you switch to opens on the node you were just looking at.
 *
 * Owns four pieces of state -- `label`, `data`, `focusPath`, `expandedPaths`
 * -- plus loading/error. `focusPath` is a root-to-node id path rather than a
 * bare id because the hierarchy is a DAG: a node can appear at more than one
 * position, and only a path names a single occurrence.
 *
 * `expandedPaths` is its own state, not derived from `focusPath`: the tree
 * can hold many branches open at once (expanding sibling A then sibling B
 * keeps both open, exactly as standalone /tree always has), while the
 * sunburst can only center on one node at a time. Deriving `expandedPaths`
 * from `focusPath` on every render would collapse every branch outside the
 * current focus on each tree interaction, which is a regression, not the
 * intended hand-off. The hand-off -- and the only place a collapse is
 * intended -- is switching from the sunburst to the tree: `expandedPaths` is
 * reseeded to `focusPath`'s prefixes at that moment, so the tree opens on the
 * node the sunburst was centered on. The reverse hand-off (tree to sunburst)
 * does not update `focusPath`; the sunburst has nowhere to represent more
 * than one open branch, so it simply keeps showing wherever it was last
 * centered.
 */
const Browse = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const view = VIEWS.includes(requestedView) ? requestedView : "sunburst";
  const previousViewRef = useRef(view);

  const [labels, setLabels] = useState(null);
  const [label, setLabel] = useState(null);
  const [data, setData] = useState(null);
  const [focusPath, setFocusPath] = useState([]);
  const [expandedPaths, setExpandedPaths] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch the labels present in the loaded data once, and pick the first.
  useEffect(() => {
    let cancelled = false;
    fetchHierarchyLabels()
      .then((result) => {
        if (cancelled) return;
        if (!Array.isArray(result) || result.length === 0) {
          setError("No hierarchy predicate is configured for this dataset (SUB_CLASS_OF).");
          setIsLoading(false);
          return;
        }
        setLabels(result);
        setLabel(result[0].label);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the root whenever the working label changes.
  useEffect(() => {
    if (!label) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchHierarchyData(label, null)
      .then((rootData) => {
        if (cancelled) return;
        setData(rootData);
        const rootPath = rootData?._id ? [rootData._id] : [];
        setFocusPath(rootPath);
        setExpandedPaths(prefixesOf(rootPath));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [label]);

  // Fetching is keyed by node id; the merge lands in `data`, which both
  // views read, so whichever view didn't do the fetching sees the result
  // without a request of its own.
  const fetchChildren = useCallback(
    async (nodeId) => {
      const children = await fetchHierarchyData(label, nodeId);
      if (!Array.isArray(children)) throw new Error(`API error for parent ${nodeId}`);
      setData((prev) => (prev ? mergeChildren(prev, nodeId, children) : prev));
      return children;
    },
    [label],
  );

  // Tree owns its own multi-branch expansion; Browse just stores whatever it
  // reports.
  const handleExpandedPathsChange = useCallback((nextPaths) => {
    setExpandedPaths(nextPaths);
  }, []);

  // The one place a collapse is intended: switching from the sunburst (which
  // can only center on one node) to the tree reseeds the tree's open
  // branches to exactly the path the sunburst was centered on.
  useEffect(() => {
    if (previousViewRef.current === "sunburst" && view === "tree") {
      setExpandedPaths(prefixesOf(focusPath));
    }
    previousViewRef.current = view;
  }, [view, focusPath]);

  const handleViewChange = useCallback(
    (nextView) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("view", nextView);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  if (error) {
    return (
      <div role="alert" className="sunburst-error-banner">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="browse-container">
      {labels && (
        <BrowseToolbar
          labels={labels}
          label={label}
          onLabelChange={setLabel}
          view={view}
          onViewChange={handleViewChange}
        />
      )}
      {isLoading && !data && <LoadingBar />}
      {data && view === "tree" && (
        <Tree
          label={label}
          data={data}
          fetchChildren={fetchChildren}
          expandedPaths={expandedPaths}
          onExpandedPathsChange={handleExpandedPathsChange}
        />
      )}
      {data && view === "sunburst" && (
        <Sunburst
          label={label}
          data={data}
          fetchChildren={fetchChildren}
          focusPath={focusPath}
          onFocusChange={setFocusPath}
        />
      )}
    </div>
  );
};

export default Browse;
