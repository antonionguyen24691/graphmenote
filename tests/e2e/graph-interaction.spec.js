const { test, expect } = require("@playwright/test");

async function waitForGraphReady(page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="graph-node"]');
}

test.describe("Graph interaction", () => {
  test("click child node focuses panel", async ({ page }) => {
    await waitForGraphReady(page);

    await page.evaluate(() => {
      const ids = window.__graphE2E?.getVisibleDisplayNodeIds?.() || [];
      if (ids.length) {
        window.__graphE2E.clickDisplayNode(ids[0]);
      }
    });
    await page.selectOption("#graphScope", "local");
    await page.waitForTimeout(400);

    const pickedChild = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-testid="graph-node"]'));
      const target = nodes.find((el) => {
        const role = el.getAttribute("data-graph-role");
        return role === "child" || role === "related" || role === "file";
      });
      if (!target) {
        return null;
      }
      const nodeId = target.getAttribute("data-node-id");
      window.__graphE2E?.clickDisplayNode?.(nodeId);
      return nodeId;
    });

    expect(pickedChild).not.toBeNull();
    await expect(page.locator("#activeNodeName")).not.toContainText("Chọn một node");
    await expect(page.locator('[data-testid="graph-node"].is-selected').first()).toBeVisible();
  });

  test("click label selects same node", async ({ page }) => {
    await waitForGraphReady(page);

    await page.selectOption("#graphLabelMode", "all");
    const label = page.locator('[data-testid="graph-node-label"]').first();
    await expect(label).toBeVisible();

    const nodeId = await label.getAttribute("data-node-id");
    await label.click();
    await expect(page.locator(`#graphNodes .graph-node[data-node-id="${nodeId}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator("#activeNodeName")).not.toContainText("Chọn một node");
  });

  test("drag node updates position", async ({ page }) => {
    await waitForGraphReady(page);
    await page.click("#graphSelectMode");

    const node = page.locator('[data-testid="graph-node"]').first();
    const nodeId = await node.getAttribute("data-node-id");
    const nodeWrap = page.locator(`.graph-node-wrap[data-node-id="${nodeId}"]`);
    await expect(node).toBeVisible();
    const before = await nodeWrap.getAttribute("style");

    await page.evaluate((id) => {
      window.__graphE2E?.dragDisplayNode?.(id, 120, 80);
    }, nodeId);

    await page.waitForTimeout(250);
    const after = await nodeWrap.getAttribute("style");
    expect(after).not.toBe(before);
  });

  test("mode switch pan/select/pin works", async ({ page }) => {
    await waitForGraphReady(page);

    await page.click("#graphPanMode");
    await expect(page.locator("#graphPanMode")).toHaveClass(/is-active/);
    await expect(page.locator("#graphViewport")).toHaveClass(/is-mode-pan/);

    await page.click("#graphPinMode");
    await expect(page.locator("#graphPinMode")).toHaveClass(/is-active/);
    await expect(page.locator("#graphViewport")).toHaveClass(/is-mode-pin/);

    const node = page.locator('[data-testid="graph-node"]').first();
    const nodeId = await node.getAttribute("data-node-id");
    await node.click();
    await expect(page.locator(`[data-testid="graph-node"][data-node-id="${nodeId}"]`)).toHaveClass(/is-pinned/);

    await page.click("#graphSelectMode");
    await expect(page.locator("#graphSelectMode")).toHaveClass(/is-active/);
    await expect(page.locator("#graphViewport")).toHaveClass(/is-mode-select/);
  });
});
