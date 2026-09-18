import { fireEvent, render, screen } from "@testing-library/react";
import { ActiveNavProvider, GraphContext } from "contexts";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom"; // Wrap with Router for routing context
import Header from "./Header";

// SearchBar pulls in the results table + search service; stub the table so the
// header test targets composition, not search internals.
jest.mock("components/SearchResultsTable/SearchResultsTable", () => () => (
  <div data-testid="search-results-table" />
));

const renderHeader = (initialEntries = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <GraphContext.Provider value={{ graphType: "phenotypes" }}>
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </GraphContext.Provider>
    </MemoryRouter>,
  );

describe("Header", () => {
  it("renders the brand, the header search, and the nav links", () => {
    renderHeader(["/graph"]);
    expect(screen.getByAltText(/NLM Cell Knowledge Network logo/i)).toBeInTheDocument();
    expect(screen.getByText("NLM Cell Knowledge Network")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Collections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Graph" })).toBeInTheDocument();
  });
});

describe("Header Component", () => {
  test("renders without crashing", () => {
    renderHeader();
  });

  test("renders all navigation links", () => {
    renderHeader();

    // Check if each navigation link is rendered
    expect(screen.getByText(/Browse/i)).toBeInTheDocument();
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText(/Graph/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });

  test("sets active class for correct link based on location", () => {
    // Simulate different routes and check if the active class is applied to the correct link
    renderHeader(["/browse"]);

    expect(screen.getByText(/Browse/i)).toHaveClass("active-nav"); // /browse should be active
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });

  test("updates active class when location changes by clicking a link", () => {
    renderHeader(["/collections"]);

    // Check the initial active class
    expect(screen.getByText(/collections/i)).toHaveClass("active-nav");
    expect(screen.getByText(/Browse/i)).not.toHaveClass("active-nav");

    // Simulate a click event on the "Browse" link to navigate to `/browse`
    fireEvent.click(screen.getByText(/Browse/i));

    // Check if the active class switches to the "Browse" link after the click
    expect(screen.getByText(/Browse/i)).toHaveClass("active-nav");
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });
});

describe("Legacy sunburst/tree redirects", () => {
  const renderAt = (initialEntries) =>
    render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/browse" element={<div>Browse page</div>} />
          <Route path="/sunburst" element={<Navigate to="/browse?view=sunburst" replace />} />
          <Route path="/tree" element={<Navigate to="/browse?view=tree" replace />} />
        </Routes>
      </MemoryRouter>,
    );

  it("redirects /sunburst to /browse", () => {
    renderAt(["/sunburst"]);
    expect(screen.getByText("Browse page")).toBeInTheDocument();
  });

  it("redirects /tree to /browse", () => {
    renderAt(["/tree"]);
    expect(screen.getByText("Browse page")).toBeInTheDocument();
  });
});
