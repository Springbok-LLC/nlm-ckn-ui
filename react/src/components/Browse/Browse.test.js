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

    await userEvent.click(await screen.findByText("test cell 0000001"));
    // Wait for the drill-in fetch's merge to actually land in state -- the
    // newly centered node's child arc appears once it has -- before
    // counting requests.
    await screen.findByText("test cell 0000003");
    const callsAfterExpand = global.fetch.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: /tree/i }));

    // The tree renders the expanded node without refetching it. Each node's
    // label is drawn twice (an outline pass then a fill pass), so this
    // checks that some match exists rather than exactly one.
    expect(await screen.findAllByText("test cell 0000003")).not.toHaveLength(0);
    expect(global.fetch.mock.calls.length).toBe(callsAfterExpand);
  });
});
