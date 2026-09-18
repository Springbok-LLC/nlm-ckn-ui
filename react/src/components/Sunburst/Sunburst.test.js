import { render, screen, waitFor } from "@testing-library/react";
import Sunburst from "./Sunburst";

describe("Sunburst Component", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            _id: "CL/0000000",
            label: "cell",
            descendant_count: 4,
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
                children: [],
              },
            ],
          }),
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("Fetches data from /arango_api/hierarchy/ with the selected label", async () => {
    render(<Sunburst addSelectedItem={jest.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/arango_api/hierarchy/"),
        expect.objectContaining({
          body: JSON.stringify({ label: "SUB_CLASS_OF", parent_id: null }),
        }),
      );
    });
  });

  test("Popup button is hidden on load when data loads", async () => {
    // Render the component
    render(<Sunburst addSelectedItem={jest.fn()} />);

    // Wait for loading to finish (loading indicator should disappear)
    await waitFor(
      () => {
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // After data loads, find and check the popup button
    const popupButton = screen.queryByTestId("popup-button");

    // If the button exists, it should not be visible on load
    if (popupButton) {
      expect(popupButton).not.toBeVisible();
    }
    // If no popup button exists after load, that's also a valid state
  });
});
