import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import nodesReducer from "../../store/nodesSlice";
import { ToastProvider } from "../Toast";
import Browse from "./Browse";

const testStore = () =>
  configureStore({
    reducer: { nodesSlice: nodesReducer },
    preloadedState: { nodesSlice: { originNodeIds: [] } },
  });

// jsdom does not implement SVGTransformList, which d3-interpolate's "transform"
// interpolator relies on when animating a <g transform="..."> attribute via
// transition. Stub it to fall through to the identity transform so tree
// updates run without throwing; positions are not asserted by these tests.
beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "transform", {
    configurable: true,
    get() {
      return { baseVal: { consolidate: () => null } };
    },
  });
});

const renderBrowse = () =>
  render(
    <Provider store={testStore()}>
      <MemoryRouter>
        <ToastProvider>
          <Browse />
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );

const root = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 2,
  weight: 2,
  value: 2,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000001",
      label: "test cell 0000001",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: null,
    },
  ],
};

const grandchild = [
  {
    _id: "CL/0000003",
    label: "test cell 0000003",
    descendant_count: 0,
    weight: 1,
    value: 1,
    _hasChildren: false,
    children: null,
  },
];

// Two sibling branches, each already carrying its own child, so expanding
// them in the tree needs no fetch -- isolates the multi-branch expansion
// behavior from the merge/fetch machinery covered by the tests above.
const branchingRoot = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 4,
  weight: 1,
  value: 1,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000010",
      label: "branch a",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [
        {
          _id: "CL/0000011",
          label: "leaf a1",
          descendant_count: 0,
          weight: 1,
          value: 1,
          _hasChildren: false,
          children: [],
        },
      ],
    },
    {
      _id: "CL/0000020",
      label: "branch b",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [
        {
          _id: "CL/0000021",
          label: "leaf b1",
          descendant_count: 0,
          weight: 1,
          value: 1,
          _hasChildren: false,
          children: [],
        },
      ],
    },
  ],
};

describe("Browse", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn((url, options) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ label: "SUB_CLASS_OF", root: "CL/0000000" }]),
        });
      }
      const body = options?.body ? JSON.parse(options.body) : {};
      if (body.parent_id === null) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(root) });
      }
      if (body.parent_id === "CL/0000001") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(grandchild) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("keeps loaded children and focus when the view toggles", async () => {
    renderBrowse();
    await screen.findAllByText("cell");

    await userEvent.click(await screen.findByText(/^test cell 0000001/));
    // Wait for the drill-in fetch's merge to actually land in state -- the
    // newly centered node's child arc appears once it has -- before
    // counting requests.
    await screen.findByText(/^test cell 0000003/);
    const callsAfterExpand = global.fetch.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: /tree/i }));

    // The tree renders the expanded node without refetching it. Each node's
    // label is drawn twice (an outline pass then a fill pass), so this
    // checks that some match exists rather than exactly one.
    expect(await screen.findAllByText(/^test cell 0000003/)).not.toHaveLength(0);
    expect(global.fetch.mock.calls.length).toBe(callsAfterExpand);
  });

  test("hand-off: focusing a node in the sunburst opens that path in the tree", async () => {
    renderBrowse();
    await screen.findAllByText("cell");

    await userEvent.click(await screen.findByText(/^test cell 0000001/));
    await screen.findByText(/^test cell 0000003/);

    await userEvent.click(screen.getByRole("button", { name: /tree/i }));

    // Both the focused node and its child are open -- the whole focus chain.
    expect(await screen.findAllByText(/^test cell 0000001/)).not.toHaveLength(0);
    expect(await screen.findAllByText(/^test cell 0000003/)).not.toHaveLength(0);
  });

  test("hand-off: toggling a path open in the tree then switching to the sunburst centers there", async () => {
    renderBrowse();
    await screen.findAllByText("cell");

    await userEvent.click(screen.getByRole("button", { name: /tree/i }));
    await screen.findAllByText("cell");

    const [target] = await screen.findAllByText(/^test cell 0000001/);
    await userEvent.click(target);
    await screen.findAllByText(/^test cell 0000003/);

    await userEvent.click(screen.getByRole("button", { name: /sunburst/i }));

    // The sunburst's center text (bold, distinct from an arc label) names the
    // node last toggled open in the tree, not the hierarchy root.
    await waitFor(() => {
      const svg = document.querySelector("svg");
      const centerText = Array.from(svg.querySelectorAll("text")).find(
        (t) => t.style.fontWeight === "bold",
      );
      expect(centerText?.textContent).toMatch(/^test cell 0000001/);
    });
  });

  test("keeps sibling branches open while working only in the tree", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ label: "SUB_CLASS_OF", root: "CL/0000000" }]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(branchingRoot) });
    });

    renderBrowse();
    await screen.findAllByText("cell");

    await userEvent.click(screen.getByRole("button", { name: /tree/i }));
    await screen.findAllByText("branch a");

    // Expand both sibling branches in turn.
    const [branchA] = await screen.findAllByText("branch a");
    await userEvent.click(branchA);
    await screen.findAllByText("leaf a1");

    const [branchB] = await screen.findAllByText("branch b");
    await userEvent.click(branchB);
    await screen.findAllByText("leaf b1");

    // Expanding branch b did not close branch a -- both stay open at once,
    // exactly as standalone /tree behaves today.
    expect(screen.queryAllByText("leaf a1").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("leaf b1").length).toBeGreaterThan(0);
  });
});

describe("Browse error state", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("shows the configured label when no hierarchy predicate is present", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    renderBrowse();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("SUB_CLASS_OF");
  });
});
