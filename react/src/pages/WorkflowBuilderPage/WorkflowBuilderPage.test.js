import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import workflowBuilderReducer, { loadWorkflow, setSolutionPhase } from "store/workflowBuilderSlice";
import WorkflowBuilderPage from "./WorkflowBuilderPage";

let mockGraphMounts = 0;
// A run sets the store's active graph, then hands the graph to the page.
jest.mock("components/WorkflowBuilder", () => ({ onGraphReady }) => {
  const dispatch = require("react-redux").useDispatch();
  const graph = { nodes: [{ _id: "CS/1" }], links: [] };
  const run = () => {
    dispatch(require("store/workflowBuilderSlice").setActiveGraph({ phaseId: "p1", graph }));
    onGraphReady(graph);
  };
  return (
    <button type="button" onClick={run}>
      Run
    </button>
  );
});
jest.mock("components/GraphWorkspace", () => () => {
  require("react").useEffect(() => {
    mockGraphMounts += 1;
  }, []);
  return <div>graph</div>;
});
jest.mock("components/WorkflowBuilder/ResultsTable", () => () => <div>step table</div>);
jest.mock("components/WorkflowBuilder/SolutionTable", () => () => <div>answer table</div>);

const phases = [{ id: "p1" }, { id: "p2" }];

const renderPage = ({ marked = false } = {}) => {
  const store = configureStore({ reducer: { workflowBuilder: workflowBuilderReducer } });
  if (marked) store.dispatch(loadWorkflow({ phases, solution: { phaseId: "p1" } }));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkflowBuilderPage />
      </MemoryRouter>
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  return store;
};
const click = (role, name) => fireEvent.click(screen.getByRole(role, { name }));
const switchGroup = () => screen.queryByRole("group", { name: "Show results as" });

describe("WorkflowBuilderPage results", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });
  beforeEach(() => {
    mockGraphMounts = 0;
  });

  it("shows no tab bar when no step is marked, and shows the graph first", () => {
    renderPage();
    expect(screen.queryByRole("tablist")).toBeNull();
    // A single-step workflow has no step buttons but still offers the switch.
    expect(screen.queryByRole("button", { name: /Phase 1/ })).toBeNull();
    expect(switchGroup()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
    expect(mockGraphMounts).toBe(1);
  });

  it("opens on Results when a step is marked, and mounts the graph only in context", () => {
    renderPage({ marked: true });
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("answer table")).toBeInTheDocument();
    expect(switchGroup()).toBeNull();
    expect(mockGraphMounts).toBe(0);
    click("tab", "Results in context");
    expect(mockGraphMounts).toBe(1);
  });

  it("opens on Results for a later workflow that has an answer", () => {
    const store = renderPage();
    act(() => store.dispatch(loadWorkflow({ phases, solution: { phaseId: "p1" } })));
    click("button", "Run");
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the context view when a step is marked after a run", () => {
    const store = renderPage();
    act(() => store.dispatch(setSolutionPhase("p1")));
    const context = screen.getByRole("tab", { name: "Results in context" });
    expect(context).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to the context view when the answer is unmarked, and stays there", () => {
    const store = renderPage({ marked: true });
    act(() => store.dispatch(setSolutionPhase(null)));
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(switchGroup()).toBeInTheDocument();
    act(() => store.dispatch(setSolutionPhase("p1")));
    const context = screen.getByRole("tab", { name: "Results in context" });
    expect(context).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the view choice and the graph mount across tabs", () => {
    renderPage({ marked: true });
    click("tab", "Results in context");
    click("button", "Table");
    click("tab", "Results");
    click("tab", "Results in context");
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    expect(mockGraphMounts).toBe(1);
    expect(screen.getByText("graph").parentElement).toHaveStyle({ display: "none" });
  });
});
