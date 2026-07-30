import { computeBigDipperTargets } from "./simulationUtils";

/** The seven collections that occupy stars, in bowl-then-handle order. */
const MOTIF = ["GS", "PR", "CHEMBL", "MONDO", "CS", "CL", "UBERON"];

describe("computeBigDipperTargets", () => {
  it("gives every motif collection a distinct star slot", () => {
    const targets = computeBigDipperTargets(MOTIF, 1000, 1000);

    for (const coll of MOTIF) {
      expect(targets[coll]).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    }

    const positions = MOTIF.map((c) => `${targets[c].x},${targets[c].y}`);
    expect(new Set(positions).size).toBe(MOTIF.length);
  });

  it("runs the handle outward from the gene star, one link at a time", () => {
    const targets = computeBigDipperTargets(MOTIF, 1000, 1000);
    const gene = targets.GS;
    const distanceFromGene = (coll) =>
      Math.hypot(targets[coll].x - gene.x, targets[coll].y - gene.y);

    // Alioth -> Mizar -> Alkaid hang off the gene in that order, so each must
    // sit farther out than the one before it.
    expect(distanceFromGene("CS")).toBeLessThan(distanceFromGene("CL"));
    expect(distanceFromGene("CL")).toBeLessThan(distanceFromGene("UBERON"));

    // The handle leaves the bowl rather than crossing it.
    const bowlMinX = Math.min(targets.GS.x, targets.PR.x, targets.CHEMBL.x, targets.MONDO.x);
    for (const coll of ["CS", "CL", "UBERON"]) {
      expect(targets[coll].x).toBeLessThan(bowlMinX);
    }
  });

  it("parks off-motif collections below the asterism instead of on a star", () => {
    const targets = computeBigDipperTargets([...MOTIF, "BMC", "GO", "PATO"], 1000, 1000);
    const lowestStar = Math.max(...MOTIF.map((c) => targets[c].y));

    for (const coll of ["BMC", "GO", "PATO"]) {
      expect(targets[coll].y).toBeGreaterThan(lowestStar);
    }
  });

  it("omits collections that are not in the graph", () => {
    const targets = computeBigDipperTargets(["GS", "MONDO"], 1000, 1000);

    expect(Object.keys(targets).sort()).toEqual(["GS", "MONDO"]);
  });

  it("scales with the canvas and stays centered on the origin", () => {
    const small = computeBigDipperTargets(MOTIF, 500, 500);
    const large = computeBigDipperTargets(MOTIF, 1000, 1000);

    expect(large.UBERON.x).toBeCloseTo(small.UBERON.x * 2);
    expect(large.PR.y).toBeCloseTo(small.PR.y * 2);

    // The seven stars are balanced around the origin, so the canvas centers on
    // the asterism rather than on one end of it.
    const mean = (axis) => MOTIF.reduce((sum, c) => sum + large[c][axis], 0) / MOTIF.length;
    expect(mean("x")).toBeCloseTo(0);
    expect(mean("y")).toBeCloseTo(0);
  });

  it("uses the short canvas axis so the shape survives a wide viewport", () => {
    const wide = computeBigDipperTargets(MOTIF, 4000, 600);
    const square = computeBigDipperTargets(MOTIF, 600, 600);

    expect(wide).toEqual(square);
  });
});
