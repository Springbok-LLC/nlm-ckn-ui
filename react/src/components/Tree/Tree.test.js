import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import nodesReducer from "../../store/nodesSlice";
import { ToastProvider } from "../Toast";
import Tree from "./Tree";

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

const renderTree = (props) =>
  render(
    <Provider store={testStore()}>
      <MemoryRouter>
        <ToastProvider>
          <Tree {...props} />
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );

const sharedCell = {
  _id: "CL/0000003",
  label: "test cell 0000003",
  descendant_count: 0,
  weight: 1,
  value: 1,
  _hasChildren: false,
  children: [],
};

// Seed shape from Task 1: root with two children that both carry the same
// (DAG-shared) child. `_id` repeats across the two occurrences on purpose --
// that repetition is exactly what broke the old id-keyed expansion state.
const twoParentFixture = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 3,
  weight: 1,
  value: 1,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000001",
      label: "test cell 0000001",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [{ ...sharedCell }],
    },
    {
      _id: "CL/0000002",
      label: "test cell 0000002",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [{ ...sharedCell }],
    },
  ],
};

describe("Tree Component", () => {
  test("reports the full path when a node is expanded", async () => {
    const onExpandedPathsChange = jest.fn();

    // Pre-expand the root and the first parent so the shared child under
    // CL/0000001 is on screen. CL/0000002's own copy of the shared child
    // stays collapsed, so exactly one occurrence of the shared label renders.
    renderTree({
      data: twoParentFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000001"]],
      onExpandedPathsChange,
    });

    // Expand the shared node under the FIRST parent.
    // The click handler is bound to the enclosing node group; the label
    // itself renders twice (a white text-outline clone plus the real text),
    // so pick the first match rather than asserting a single unique node.
    const [target] = await screen.findAllByText("test cell 0000003");
    await userEvent.click(target);

    expect(onExpandedPathsChange).toHaveBeenCalledWith([
      ["CL/0000000"],
      ["CL/0000000", "CL/0000001"],
      ["CL/0000000", "CL/0000001", "CL/0000003"],
    ]);
  });

  test("expanding one occurrence of a shared node does not expand the other", async () => {
    const onExpandedPathsChange = jest.fn();

    // Pre-expand both parents, so both occurrences of the shared child are
    // reachable. Give each occurrence a distinct label only so the click
    // target is unambiguous -- the underlying `_id` is still shared, which is
    // the case this test exists to cover.
    const bothParentsExpandedFixture = {
      ...twoParentFixture,
      children: [
        {
          ...twoParentFixture.children[0],
          children: [{ ...sharedCell, label: "shared under parent one" }],
        },
        {
          ...twoParentFixture.children[1],
          children: [{ ...sharedCell, label: "shared under parent two" }],
        },
      ],
    };

    renderTree({
      data: bothParentsExpandedFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000001"], ["CL/0000000", "CL/0000002"]],
      onExpandedPathsChange,
    });

    const [target] = await screen.findAllByText("shared under parent two");
    await userEvent.click(target);

    expect(onExpandedPathsChange).toHaveBeenCalledWith([
      ["CL/0000000"],
      ["CL/0000000", "CL/0000001"],
      ["CL/0000000", "CL/0000002"],
      ["CL/0000000", "CL/0000002", "CL/0000003"],
    ]);
  });

  test("collapses an already-expanded node on a second click", async () => {
    const onExpandedPathsChange = jest.fn();

    renderTree({
      data: twoParentFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000001"]],
      onExpandedPathsChange,
    });

    const [target] = await screen.findAllByText("test cell 0000001");
    await userEvent.click(target);

    expect(onExpandedPathsChange).toHaveBeenCalledWith([["CL/0000000"]]);
  });
});
