import { render, screen } from "@testing-library/react";
import NodeSearchInput from "./NodeSearchInput";

const mockSearch = {
  query: "t cell",
  setQuery: jest.fn(),
  results: [],
  isOpen: true,
  setIsOpen: jest.fn(),
  isLoading: false,
  error: false,
  highlightedIndex: -1,
  containerRef: { current: null },
  clearSearch: jest.fn(),
  handleKeyDown: jest.fn(),
};

jest.mock("hooks", () => ({ useSearch: () => mockSearch }));
jest.mock("utils", () => ({
  getCollectionColor: () => "#336699",
  getCollectionDisplayName: (name) => name,
  getLabel: (item) => item.label || item._id,
}));

describe("NodeSearchInput", () => {
  afterEach(() => {
    mockSearch.error = false;
  });

  it("shows the failure message and no empty state when the search errored", () => {
    mockSearch.error = true;
    render(<NodeSearchInput onSelectNode={jest.fn()} />);

    expect(screen.getByText("Search failed. Try again.", { ignore: "output" })).toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  });

  it("shows the empty state after a completed empty search", () => {
    render(<NodeSearchInput onSelectNode={jest.fn()} />);

    expect(screen.getByText("No results found", { ignore: "output" })).toBeInTheDocument();
    expect(screen.queryByText("Search failed. Try again.")).not.toBeInTheDocument();
  });

  it("keeps a polite live region that announces the settled state", () => {
    render(<NodeSearchInput onSelectNode={jest.fn()} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("No results found");
  });

  it("announces nothing while loading", () => {
    mockSearch.isLoading = true;
    render(<NodeSearchInput onSelectNode={jest.fn()} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    mockSearch.isLoading = false;
  });
});
