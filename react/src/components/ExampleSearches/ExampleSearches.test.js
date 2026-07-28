import { fireEvent, render, screen } from "@testing-library/react";
import ExampleSearches from "./ExampleSearches";

const EXAMPLES = [
  { term: "pericyte", type: "Cell type" },
  { term: "KCNK3", type: "Gene" },
];

test("renders a chip per example with term and type", () => {
  render(<ExampleSearches examples={EXAMPLES} onPick={() => {}} />);
  expect(screen.getByRole("button", { name: /pericyte/i })).toBeInTheDocument();
  expect(screen.getByText("Cell type")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /KCNK3/i })).toBeInTheDocument();
  expect(screen.getByText("Gene")).toBeInTheDocument();
});

test("clicking a chip calls onPick with its term", () => {
  const onPick = jest.fn();
  render(<ExampleSearches examples={EXAMPLES} onPick={onPick} />);
  fireEvent.click(screen.getByRole("button", { name: /pericyte/i }));
  expect(onPick).toHaveBeenCalledWith("pericyte");
});

test("renders nothing when there are no examples", () => {
  const { container } = render(<ExampleSearches examples={[]} onPick={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
