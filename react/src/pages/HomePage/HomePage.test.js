import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomePage from "./HomePage";

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

describe("HomePage", () => {
  it("renders the About NLM-CKN heading and intro", () => {
    renderHome();
    expect(screen.getByRole("heading", { name: /About NLM-CKN/i })).toBeInTheDocument();
    expect(screen.getByText(/National Library of Medicine/i)).toBeInTheDocument();
  });

  it("links to the About page", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /Learn more/i })).toHaveAttribute("href", "/about");
  });

  it("does not render a search input (search lives in the header)", () => {
    renderHome();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search NLM-CKN/i)).not.toBeInTheDocument();
  });
});
