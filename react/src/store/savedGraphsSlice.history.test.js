import reducer, {
  addHistoryEntry,
  deleteHistoryEntry,
  mergeCheckedSubgraphs,
  selectOriginHistory,
  toggleHistoryEntry,
} from "./savedGraphsSlice";

const entry = (originId, nodeIds, checked = true) => ({
  id: `h-${originId}`,
  originId,
  label: originId,
  checked,
  timestamp: "t",
  thumbnail: null,
  subgraph: {
    nodes: nodeIds.map((n) => ({ _id: n, id: n, x: 1, y: 2 })),
    links: [],
  },
});

describe("originHistory", () => {
  it("addHistoryEntry appends and does not duplicate the same origin", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A", "n1"])));
    s = reducer(s, addHistoryEntry(entry("A", ["A", "n1"])));
    expect(s.originHistory).toHaveLength(1);
    s = reducer(s, addHistoryEntry(entry("B", ["B", "n2"])));
    expect(s.originHistory.map((e) => e.originId)).toEqual(["A", "B"]);
  });

  it("toggleHistoryEntry flips checked", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    s = reducer(s, toggleHistoryEntry("h-A"));
    expect(s.originHistory[0].checked).toBe(false);
  });

  it("deleteHistoryEntry removes it", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    s = reducer(s, deleteHistoryEntry("h-A"));
    expect(s.originHistory).toHaveLength(0);
  });

  it("mergeCheckedSubgraphs unions checked entries and dedupes shared nodes by _id", () => {
    const history = [
      entry("A", ["A", "shared"], true),
      entry("B", ["B", "shared"], true),
      entry("C", ["C"], false),
    ];
    const { nodes } = mergeCheckedSubgraphs(history);
    const ids = nodes.map((n) => n._id).sort();
    expect(ids).toEqual(["A", "B", "shared"]); // C excluded (unchecked), shared once
  });
});
