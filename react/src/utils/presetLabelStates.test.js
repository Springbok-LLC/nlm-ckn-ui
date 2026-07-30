import { DEFAULT_LABEL_STATES } from "constants/graph";
import { resolvePresetLabelStates } from "./graph";

describe("resolvePresetLabelStates", () => {
  it("returns null for a preset that does not declare label states", () => {
    expect(resolvePresetLabelStates({ id: "some-preset" })).toBeNull();
  });

  it("merges a partial declaration over the defaults", () => {
    const resolved = resolvePresetLabelStates({
      id: "dipper-explorer",
      labelStates: { "link-label": false },
    });

    expect(resolved).toEqual({ ...DEFAULT_LABEL_STATES, "link-label": false });
  });

  it("leaves the shared defaults untouched", () => {
    const before = { ...DEFAULT_LABEL_STATES };
    resolvePresetLabelStates({ labelStates: { "node-label": false } });

    expect(DEFAULT_LABEL_STATES).toEqual(before);
  });

  it("ignores keys that are not real label classes", () => {
    const resolved = resolvePresetLabelStates({
      labelStates: { "link-label": false, "not-a-label": true },
    });

    expect(resolved).not.toHaveProperty("not-a-label");
  });
});
