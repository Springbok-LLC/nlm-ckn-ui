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
// neighborhood (`originSubgraphs`). The bulk graph fetch behind Generate
// Graph now populates that per-origin state directly, so seeding two
// origins the ordinary way is enough to exercise composition — no need to
// promote plain nodes to origins first.
const originA = doc("ORIGIN_A", "Origin A");
const originB = doc("ORIGIN_B", "Origin B");
const shared = doc("SHARED", "Shared Node");
const aOnly = doc("A_ONLY", "A Only");
const bOnly = doc("B_ONLY", "B Only");

const originAId = originA._id;
const originBId = originB._id;

function neighborhoodFor(nodeId: string) {
  if (nodeId === originAId) {
    return {
      nodes: [originA, shared, aOnly],
      links: [
        edge("E_A_SHARED", originA._id, shared._id, "related"),
        edge("E_A_ONLY", originA._id, aOnly._id, "related"),
      ],
    };
  }
  if (nodeId === originBId) {
    return {
      nodes: [originB, shared, bOnly],
      links: [
        edge("E_B_SHARED", originB._id, shared._id, "related"),
        edge("E_B_ONLY", originB._id, bOnly._id, "related"),
      ],
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
  // same endpoint (node_ids: [id]) — keying by node_ids covers both the
  // initial bulk fetch and that re-fetch.
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
  test.setTimeout(60000);
  await installErrorInstrumentation(page);
  await setupMocks(page);

  // Seed both origins via redux-persist, as the sibling graph specs do.
  await page.addInitScript(
    (ids) => {
      const persistedRoot = {
        nodesSlice: JSON.stringify({ originNodeIds: ids }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      };
      localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
    },
    [originAId, originBId],
  );

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  // Union graph: ORIGIN_A, ORIGIN_B, SHARED, A_ONLY, B_ONLY.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(5);
  }).toPass({ timeout: 5000 });

  // Snapshot the shared node's on-screen position before removing an origin.
  const sharedNode = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  await sharedNode.waitFor({ state: "visible" });
  const beforeBox = await sharedNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  // Right-click ORIGIN_B and remove it as an origin.
  const originBNode = page.locator("g.node").filter({ hasText: "Origin B" }).first();
  await originBNode.waitFor({ state: "visible" });
  const popup = await openNodeContextMenu(page, originBNode);
  const removeButton = popup.getByRole("button", { name: "Remove as origin", exact: true });
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  // After removal: ORIGIN_B and B_ONLY (only in B's captured neighborhood)
  // are gone; ORIGIN_A, SHARED, A_ONLY (all in A's neighborhood) remain.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Origin B" })).toHaveCount(0);
  await expect(page.locator("g.node").filter({ hasText: "B Only" })).toHaveCount(0);
  await expect(page.locator("g.node").filter({ hasText: "Origin A" })).toHaveCount(1);
  await expect(page.locator("g.node").filter({ hasText: "A Only" })).toHaveCount(1);

  // SHARED itself survives (it's still in A's neighborhood), holding
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

  // Origins panel lists the remaining origin (ORIGIN_A) and can be closed.
  await page.getByRole("button", { name: /^origins$/i }).click();
  const panel = page.getByRole("complementary", { name: /current origins/i });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Origin A");
  await expect(panel).not.toContainText("Origin B");

  await page.getByLabel(/close origins panel/i).click();
  await expect(panel).toBeHidden();

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
