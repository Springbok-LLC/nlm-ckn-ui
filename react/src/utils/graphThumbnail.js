// The graph legend is a direct child of the live <svg> (added by
// ForceGraphConstructor) and is pinned to a corner of the live viewBox. At
// thumbnail scale it is unreadable clutter, so it is dropped from the clone —
// and, so the frame doesn't reserve empty space where it used to be, excluded
// from the measurement too.
const LEGEND_SELECTOR = "g.legend";

/**
 * Maps a point through an SVGMatrix-shaped transform. A null matrix is the
 * identity.
 */
const mapPoint = (matrix, x, y) =>
  matrix
    ? { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }
    : { x, y };

/**
 * Measures the graph content — every direct child of the SVG except the legend
 * — in the SVG's own user space, so the result can be used as a viewBox.
 *
 * A child's getBBox is in that child's local space (d3-zoom's container group
 * carries the pan/zoom transform), so each box is mapped through the child's
 * own transform before being unioned.
 *
 * @param {SVGElement} svgElement
 * @returns {{x: number, y: number, width: number, height: number}|null} null
 *   when nothing measurable is present.
 */
const measureGraphContent = (svgElement) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of Array.from(svgElement.childNodes ?? [])) {
    if (child.nodeType !== 1) continue;
    if (typeof child.matches === "function" && child.matches(LEGEND_SELECTOR)) continue;
    if (typeof child.getBBox !== "function") continue;
    const box = child.getBBox();
    if (!box || !(box.width > 0) || !(box.height > 0)) continue;
    const matrix = child.transform?.baseVal?.consolidate?.()?.matrix ?? null;
    for (const [px, py] of [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ]) {
      const { x, y } = mapPoint(matrix, px, py);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX) || !(maxX > minX) || !(maxY > minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Serializes an SVG element into an inline data URL for use as a saved-graph
 * thumbnail. The legend is stripped from the copy. Best-effort: returns null
 * instead of throwing on any failure.
 *
 * The clone and serialization run synchronously despite the async signature
 * (there is no await before them), so the returned data URL describes the DOM
 * exactly as it stood at the moment of the call. Callers rely on that to
 * snapshot an outgoing graph before it is replaced.
 *
 * @param {SVGElement|null} svgElement
 * @param {{ width?: number, height?: number }} [opts]
 * @returns {Promise<string|null>}
 */
export const captureGraphThumbnail = async (svgElement, { width = 240, height = 160 } = {}) => {
  try {
    if (!svgElement || typeof svgElement.cloneNode !== "function") return null;
    const clone = svgElement.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    // Drop the legend from the copy (never from the live SVG).
    try {
      if (typeof clone.querySelectorAll === "function") {
        for (const legend of Array.from(clone.querySelectorAll(LEGEND_SELECTOR))) {
          legend.remove();
        }
      }
    } catch {
      // Keep the legend rather than losing the thumbnail.
    }

    // Best-effort tight-frame to the graph content so the fixed-size thumbnail
    // isn't cropped to an empty margin of the live viewBox. Measured on the
    // graph content rather than the whole SVG, so the removed legend doesn't
    // leave a reserved gap. Falls back to whole-SVG measurement, and then to
    // the clone's existing viewBox, when bounding-box measurement isn't
    // available (e.g. the element isn't laid out, or getBBox is unsupported).
    try {
      const box =
        measureGraphContent(svgElement) ??
        (typeof svgElement.getBBox === "function" ? svgElement.getBBox() : null);
      if (box && box.width > 0 && box.height > 0) {
        const padX = box.width * 0.08;
        const padY = box.height * 0.08;
        clone.setAttribute(
          "viewBox",
          `${box.x - padX} ${box.y - padY} ${box.width + 2 * padX} ${box.height + 2 * padY}`,
        );
      }
    } catch {
      // Keep the clone's existing viewBox.
    }

    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const serialized = new XMLSerializer().serializeToString(clone);
    const encoded = encodeURIComponent(serialized);
    return `data:image/svg+xml;charset=utf-8,${encoded}`;
  } catch {
    return null;
  }
};
