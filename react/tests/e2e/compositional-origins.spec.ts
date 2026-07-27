import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { openNodeContextMenu } from "./utils/graphInteractions";
import { doc, edge } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";

// The live graph is a client-side union of each origin's own captured
// neighborhood (`originSubgraphs`), which is only populated by the
// addOriginNode/removeOriginNode thunks — never by the initial bulk graph
// fetch (Generate Graph). So to get two origins that both actually have a
// captured subgraph, this test:
//   1. Seeds a disposable SEED origin via the ordinary Generate Graph flow.
//      SEED's neighborhood includes ORIGIN as a plain (non-origin) node.
//   2. Promotes ORIGIN to a real origin via the context menu's
//      "Add as origin" — this is what captures ORIGIN's own neighborhood
//      (ORIGIN, SHARED, ORIGIN_ONLY) into originSubgraphs. SEED, having no
//      captured subgraph of its own, drops out of the composed graph at
//      this point, which is expected and irrelevant to the test.
//   3. Promotes SHARED (already rendered, not yet an origin) to a second
//      real origin the same way, capturing (SHARED, SHARED_ONLY).
// Removing SHARED as an origin then exercises the real removeOriginNode
// path: SHARED_ONLY (only in SHARED's captured neighborhood) drops, while
// ORIGIN, SHARED, and ORIGIN_ONLY (all still in ORIGIN's captured
// neighborhood) survive untouched.
const seed = doc("SEED", "Seed Node");
const origin = doc("ORIGIN", "Origin Node");
const shared = doc("SHARED", "Shared Node");
const originOnly = doc("ORIGIN_ONLY", "Origin Only");
const sharedOnly = doc("SHARED_ONLY", "Shared Only");

const seedId = seed._id;
const originId = origin._id;
const sharedId = shared._id;

function neighborhoodFor(nodeId: string) {
  if (nodeId === seedId) {
    return {
      nodes: [seed, origin],
      links: [edge("E_SEED_ORIGIN", seed._id, origin._id, "related")],
    };
  }
  if (nodeId === originId) {
    return {
      nodes: [origin, shared, originOnly],
      links: [
        edge("E_ORIGIN_SHARED", origin._id, shared._id, "related"),
        edge("E_ORIGIN_ONLY", origin._id, originOnly._id, "related"),
      ],
    };
  }
  if (nodeId === sharedId) {
    return {
      nodes: [shared, sharedOnly],
      links: [edge("E_SHARED_ONLY", shared._id, sharedOnly._id, "related")],
    };
  }
  return { nodes: [], links: [] };
}

async function setupMocks(page: import("@playwright/test").Page) {
  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([COLL]),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ Label: { type: "categorical", values: ["related"] } }),
      });
    }
    return route.continue();
  });

  // graph/ (union query + single-origin re-fetch): return each requested
  // node id's neighborhood. addOriginNode re-queries one origin through this
  // same endpoint (depth === EXPANSION_DEPTH, node_ids: [id]) — keying by
  // node_ids covers both the initial fetch and that re-fetch.
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();
      const nodeIds: string[] = body.node_ids || [];
      const payload: Record<string, { nodes: unknown[]; links: unknown[] }> = {};
      for (const id of nodeIds) {
        payload[id] = neighborhoodFor(id);
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }
    return route.continue();
  });

  // edges-between/ (cross-origin edge fill): no cross edges needed for this
  // test, an empty array is sufficient.
  await page.route("**/arango_api/graph/edges-between/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      const results = ids.map((id) => ({ _id: id, label: id.split("/")[1] }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(results),
      });
    }
    return route.continue();
  });
}

test("Removing an origin drops its unshared nodes and preserves shared node position", async ({
  page,
}) => {
  await installErrorInstrumentation(page);
  await setupMocks(page);

  // Seed the disposable SEED origin via redux-persist, as the sibling graph
  // specs do.
  await page.addInitScript((id) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [id] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    };
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, seedId);

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  // Initial graph: SEED, ORIGIN.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(2);
  }).toPass({ timeout: 5000 });

  // Promote ORIGIN (already rendered, not yet an origin) to a real origin via
  // the context menu, which captures its own neighborhood (ORIGIN, SHARED,
  // ORIGIN_ONLY) into originSubgraphs. SEED has no captured subgraph, so it
  // drops out of the composed graph here — expected and irrelevant.
  const originNode = page.locator("g.node").filter({ hasText: "Origin Node" }).first();
  await originNode.waitFor({ state: "visible" });
  let popup = await openNodeContextMenu(page, originNode);
  await popup.getByRole("button", { name: "Add as origin", exact: true }).click();

  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Seed Node" })).toHaveCount(0);

  // Promote SHARED (already rendered, not yet an origin) to a second real
  // origin the same way, capturing (SHARED, SHARED_ONLY).
  const sharedNode = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  await sharedNode.waitFor({ state: "visible" });
  popup = await openNodeContextMenu(page, sharedNode);
  await popup.getByRole("button", { name: "Add as origin", exact: true }).click();

  // Composed graph now includes SHARED_ONLY too: ORIGIN, SHARED, ORIGIN_ONLY, SHARED_ONLY.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(4);
  }).toPass({ timeout: 5000 });

  // Snapshot the shared node's on-screen position before removing it as an origin.
  const sharedNodeSettled = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  await sharedNodeSettled.waitFor({ state: "visible" });
  const beforeBox = await sharedNodeSettled.boundingBox();
  expect(beforeBox).not.toBeNull();

  // Right-click SHARED again — now an origin — and remove it as an origin.
  const removePopup = await openNodeContextMenu(page, sharedNodeSettled);
  const removeButton = removePopup.getByRole("button", { name: "Remove as origin", exact: true });
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  // After removal: SHARED_ONLY (only in SHARED's captured neighborhood) is
  // gone; ORIGIN, SHARED, ORIGIN_ONLY (all in ORIGIN's neighborhood) remain.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Shared Only" })).toHaveCount(0);
  await expect(page.locator("g.node").filter({ hasText: "Origin Node" })).toHaveCount(1);
  await expect(page.locator("g.node").filter({ hasText: "Origin Only" })).toHaveCount(1);

  // SHARED itself survives (it's still in ORIGIN's neighborhood), holding
  // approximately its pre-removal position — layout is preserved, not
  // reflowed.
  const sharedNodeAfter = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  await sharedNodeAfter.waitFor({ state: "visible" });
  const afterBox = await sharedNodeAfter.boundingBox();
  expect(afterBox).not.toBeNull();
  if (beforeBox && afterBox) {
    expect(Math.abs(afterBox.x - beforeBox.x)).toBeLessThanOrEqual(20);
    expect(Math.abs(afterBox.y - beforeBox.y)).toBeLessThanOrEqual(20);
  }

  // Origins panel lists the remaining origin (ORIGIN) and can be closed.
  await page.getByRole("button", { name: /^origins$/i }).click();
  const panel = page.getByRole("complementary", { name: /current origins/i });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Origin Node");
  await expect(panel).not.toContainText("Shared Node");

  await page.getByLabel(/close origins panel/i).click();
  await expect(panel).toBeHidden();

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
