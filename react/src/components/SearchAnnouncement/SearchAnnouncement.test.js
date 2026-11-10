import { render, screen } from "@testing-library/react";
import SearchAnnouncement, { searchAnnouncement } from "./SearchAnnouncement";

const base = { query: "t cell", results: [], isLoading: false, error: false };
const rows = (n) => Array.from({ length: n }, (_, i) => ({ _id: `CL/${i}` }));

describe("searchAnnouncement", () => {
  it("is empty for a blank query", () => {
    expect(searchAnnouncement({ ...base, query: "  " })).toBe("");
  });

  it("is empty while loading", () => {
    expect(searchAnnouncement({ ...base, isLoading: true, results: rows(3) })).toBe("");
  });

  it("announces failure", () => {
    expect(searchAnnouncement({ ...base, error: true })).toBe("Search failed. Try again.");
  });

  it("announces an empty settled search", () => {
    expect(searchAnnouncement(base)).toBe("No results found");
  });

  it("uses the singular for one result", () => {
    expect(searchAnnouncement({ ...base, results: rows(1) })).toBe("1 result");
  });

  it("uses the plural for several results", () => {
    expect(searchAnnouncement({ ...base, results: rows(12) })).toBe("12 results");
  });

  it("says 50 or more once the cap is reached", () => {
    expect(searchAnnouncement({ ...base, results: rows(49) })).toBe("49 results");
    expect(searchAnnouncement({ ...base, results: rows(50) })).toBe("50 or more results");
  });
});

describe("SearchAnnouncement", () => {
  it("renders a polite, visually hidden live region that stays mounted when empty", () => {
    render(<SearchAnnouncement {...base} query="" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("visually-hidden");
    expect(region).toBeEmptyDOMElement();
  });

  it("shows the settled text", () => {
    render(<SearchAnnouncement {...base} results={rows(2)} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 results");
  });
});
