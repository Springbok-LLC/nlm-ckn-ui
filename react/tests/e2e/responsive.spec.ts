import { expect, test } from "@playwright/test";

// Routes that render without a backend (the header — where the overflow lives —
// is global, so these prove the fix app-wide).
const ROUTES = [
  ["home", "/#/"],
  ["about", "/#/about"],
  ["graph", "/#/graph"],
  ["not-found", "/#/invalid-route-xyz"],
];

for (const width of [390, 1200]) {
  for (const [name, path] of ROUTES) {
    test(`no horizontal overflow at ${width}px on ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path, { waitUntil: "networkidle" });
      // Allow 1px for sub-pixel rounding.
      const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, width);
      expect(overflow, `scrollWidth exceeds ${width}px by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }
}
