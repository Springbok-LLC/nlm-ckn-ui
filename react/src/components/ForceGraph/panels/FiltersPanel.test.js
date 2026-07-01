import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer, { setEdgeFilterMode } from "../../../store/graphSlice";
import FiltersPanel from "./FiltersPanel";

const renderPanel = (mode = "include", isAdvancedMode = false) => {
  const store = configureStore({ reducer: { graph: graphReducer } });
  const dispatchSpy = jest.spyOn(store, "dispatch");
  const settings = {
    allCollections: [],
    allowedCollections: [],
    edgeFilters: { Label: [] },
    edgeFilterModes: { Label: mode },
  };
  render(
    <Provider store={store}>
      <FiltersPanel
        settings={settings}
        collectionMaps={new Map()}
        availableEdgeFilters={{ Label: { type: "categorical", values: ["DERIVES_FROM"] } }}
        edgeFilterStatus="succeeded"
        onCollectionChange={() => {}}
        onCollectionsClearAll={() => {}}
        graphLinks={[{ Label: "DERIVES_FROM" }]}
        isAdvancedMode={isAdvancedMode}
      />
    </Provider>,
  );
  return { dispatchSpy };
};

describe("FiltersPanel edge filter mode toggle", () => {
  it("toggling Exclude dispatches setEdgeFilterMode exclude", () => {
    const { dispatchSpy } = renderPanel("include");
    fireEvent.click(screen.getByRole("button", { name: /exclude/i }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      setEdgeFilterMode({ field: "Label", mode: "exclude" }),
    );
  });

  it("renders an Include and an Exclude control for a categorical field", () => {
    renderPanel("include");
    expect(screen.getByRole("button", { name: /include/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exclude/i })).toBeInTheDocument();
  });

  it("dropdown label reflects include mode", () => {
    renderPanel("include");
    expect(screen.getByPlaceholderText(/show only these/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/hide these/i)).not.toBeInTheDocument();
  });

  it("dropdown label reflects exclude mode", () => {
    renderPanel("exclude");
    expect(screen.getByPlaceholderText(/hide these/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/show only these/i)).not.toBeInTheDocument();
  });

  it("hides the Include/Exclude toggle in advanced mode", () => {
    // Advanced mode does not apply edge-filter modes yet, so the toggle must
    // not be shown; the legacy include-only dropdown is rendered instead.
    renderPanel("include", true);
    expect(screen.queryByRole("button", { name: /exclude/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^include$/i })).not.toBeInTheDocument();
    // Legacy dropdown uses the bare field name as its placeholder label.
    expect(screen.getByPlaceholderText(/filter by label/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/show only these|hide these/i)).not.toBeInTheDocument();
  });
});
