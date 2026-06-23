# 0001 — Stable graph expansion (incremental layout + user pins)

**Status**: Accepted

**Date**: 2026-06-22

**Implemented in**: PR [#72](https://github.com/Springbok-LLC/nlm-ckn-ui/pull/72)
(commit `5ff6665`)

## Context

The `/graph` page renders a D3 v7 force-directed graph from raw `d3-force`
primitives (no `react-force-graph`/`cytoscape`/`sigma` wrapper). Until this
change, every time the user expanded a node, the simulation re-heated against
the full merged node set and the entire layout re-flowed. Existing nodes
visibly migrated to new positions to find equilibrium with the incoming ones.

This created a recurring UX problem: users build a mental model of where things
are as they explore — "the cell type I care about is over here, the dataset is
top-right" — and every expand destroyed that model. The graph-visualization
literature names this directly: "preserve mental map" (Misue et al. 1995,
Diehl/Görg/Kerren 2001, Purchase/Hoggan 2006/2013). Production tools solve it
with **incremental layout**: when new nodes arrive, fix the positions of the
nodes already in the scene and let only the new ones flow in. Linkurious calls
this "Incremental expand"; yFiles documents it; the pattern is well-established.

We also wanted users to be able to:
- explicitly pin a node so it never moves, independent of any auto-pinning we
  do for stability
- see at a glance which nodes are pinned
- release all pins and re-flow the layout
- save a graph and have its pin state survive a load

Three forces shaped the decision space:
1. Drag-end already pinned nodes via `fx`/`fy` (commit `aa9e193`). Any new pin
   model had to coexist with — and ideally reuse — that primitive.
2. The simulation lifecycle is asynchronous (`waitForAlpha` resolves when alpha
   cools); Playwright tests needed a deterministic way to wait for "the layout
   is stable now" without resorting to fixed timeouts.
3. The right-click context menu already housed all node-level actions
   (Expand, Collapse, Go To, Remove); a Pin action belonged there for
   discoverability rather than as a new toolbar.

## Decision

We adopt **incremental layout by default for every `updateGraph` call** and
distinguish **user-set pins** from the **transient auto-pins** that incremental
layout installs.

The mechanism rests on five concrete choices:

### 1. A single `userPinned: boolean` field on every node

`userPinned: true` means a human pinned this node (drag-end, the new Pin
action, or a restored saved graph). The incremental-expand auto-release loop
must never touch `fx`/`fy` on these nodes.

Auto-pins use a separate internal marker (`_autoPinned`) so the release loop
knows exactly what it set and exactly what to release.

`userPinned` flows through `processGraphData`'s reference-preserving merge
(`existingNodes.concat(processedNewNodes)`), through `getCurrentGraph`'s
`...rest` spread for save, and through `loadGraph`'s direct `graphData`
assignment on load. It also rides through `updateNodePosition` and
`updateNodePositions` Redux reducers when present in the payload, so a
constructor remount re-hydrates with the correct pin state.

### 2. Pin model is **click-driven**, not hover-driven

A "hover query" framing was considered first. We rejected it because:
- Hover fires per-pixel and triggers accidental state changes when sweeping
  across nodes.
- Hover-only doesn't work on touch devices and is opaque to screen readers
  and keyboard users.
- Once the right-click menu carries the Pin action and drag pins implicitly,
  there's no remaining need for a hover-based pin.

Click (or right-click for menu actions) is the primary interaction; the
existing hover `<title>` tooltip is left untouched for inline node info.

### 3. Pin marker uses an **inline SVG path**, not an emoji

The marker is the Material Design `push_pin` path appended inside every
`g.node` and gated by a `.pinned` CSS class on the parent group. We mirror the
existing `.selected` class pattern used by the lasso selection.

Emoji (`📌`) were rejected: rendering varies by OS, degrades at small sizes,
has inconsistent baseline alignment across browsers, and breaks visual
consistency when running on Linux servers (e.g., CI screenshot diffs).

### 4. `clearAllPins` is **not undoable**

The "Reset positions" button dispatches `clearAllPins` and reheats the
simulation. We deliberately omit `clearAllPins` from the `redux-undo` `filter`
list: it is a layout operation analogous to "Restart Simulation," not a
topology change. This matches the convention in Gephi, Cytoscape, and
Linkurious, where layout-modifying actions are not part of the undo stack.

### 5. A `data-sim-settled` attribute on the SVG root is the test sentinel

The SVG element carries `data-sim-settled="true"` when the layout is stable and
`"false"` while a layout pass is in flight. `updateGraph`, `restoreGraph`, and
`unpinAll` set it to `false` at the start of their async paths and flip it
back to `true` once `runSimulation(false)` has drained alpha and the auto-pin
release has run.

Playwright tests wait on
`expect(svg).toHaveAttribute("data-sim-settled", "true")` instead of using
`page.waitForTimeout(ms)`. This eliminates the flake class where a test
asserts node positions before the simulation has settled.

## Consequences

### Positive

- Existing nodes' positions are exactly preserved across expansion.
  Playwright asserts equality of the rendered `transform` attribute, not a
  tolerance — auto-pinned nodes literally do not move.
- The `userPinned` flag survives Redux roundtrips, save/load, undo/redo, and
  collapse/expand cycles without any per-call-site code, because
  `processGraphData` preserves existing node objects by reference and the
  reducers pass the field through when present.
- Drag-pin (pre-existing), the new Pin action, and restored saved pins all
  go through the same `userPinned`/`fx`/`fy` mechanism. A future feature
  that needs to read "is this node pinned?" has a single source of truth.
- E2E test flakiness around the simulation lifecycle is structurally avoided
  by the `data-sim-settled` sentinel — tests stop racing the alpha cooldown.

### Negative / accepted trade-offs

- **Layout-mode switches silently un-pin everything.**
  `simulationUtils.applyLayoutMode` (circular / grid / hierarchical
  branches) unconditionally clears `fx`/`fy`. Switching the layout dropdown
  therefore wipes user pins without warning. This is an out-of-scope
  interaction we accept for v1; the fix needs a product decision (preserve,
  reset, or prompt). Tracked separately.
- **manyBody asymmetry with many pinned nodes.** When most of the existing
  graph is pinned, new nodes receive full repulsion from those pins but the
  pins can't recoil. In dense subgraphs new nodes can end up further from
  their natural settle position than they would in a fully-free simulation.
  Tunable via `nodeForceStrength` if it becomes a visible issue; not a
  correctness problem.
- **`userPinned` is a new field every node persists.** Old saved graphs lack
  it; that's fine because falsy === not-pinned. But the field is now part
  of the saved-graph schema's de-facto contract — future schema migrations
  must preserve it.
- **`_autoPinned` is an internal marker that doesn't reach Redux.** It only
  exists on the live D3 node objects between the auto-pin loop and the
  auto-release loop. Anyone reading the simulation array directly should
  know it can appear there.

### Out of scope (deferred)

- A "freeze the world" mode that disables all expansion and switches the
  graph into a read-only inspection state.
- A left-side detail panel showing aggregate info about a clicked node
  (neighbor counts by type, connected-dataset count, etc.). This was an
  alternative framing considered during design and remains worth doing on
  its own merits, but it is a separate feature with its own surface area
  (new backend aggregate endpoint, new panel component, new CSS column).

## References

- D3 v7 force simulation `fx`/`fy` semantics:
  https://d3js.org/d3-force/simulation#simulation_nodes
- Misue, Eades, Lai, Sugiyama (1995). "Layout adjustment and the mental map,"
  *Journal of Visual Languages & Computing* 6(2).
- Linkurious user manual — "Incremental expand" layout mode.
- Cerioli, M. et al. (2024). "Designing complex network visualisations using
  the wayfinding map metaphor," *Information Visualization*.
