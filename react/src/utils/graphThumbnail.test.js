import { captureGraphThumbnail } from "./graphThumbnail";

describe("captureGraphThumbnail", () => {
  it("returns null when no element is provided", async () => {
    await expect(captureGraphThumbnail(null)).resolves.toBeNull();
  });

  it("serializes an svg element to a data url", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "100");
    const url = await captureGraphThumbnail(svg);
    expect(typeof url).toBe("string");
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("returns null (does not throw) on serialization failure", async () => {
    await expect(captureGraphThumbnail({})).resolves.toBeNull();
  });

  it("returns null for a non-element", async () => {
    expect(await captureGraphThumbnail(null)).toBeNull();
  });

  it("serializes an SVG to a namespaced data URL", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    svg.appendChild(circle);
    const url = await captureGraphThumbnail(svg);
    expect(url).toMatch(/^data:image\/svg\+xml/);
    // The decoded markup must carry the SVG namespace, or browsers render a broken image.
    expect(decodeURIComponent(url)).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});
