import { expect, test, type Page } from "@playwright/test";

// Mock mode (playwright.config.ts): no key to enter — opening /studio takes the studio — and the
// fake server simulates speaking requests ~1.2 s after the studio opens.
async function openStudio(page: Page): Promise<void> {
  await page.goto("/studio");
  await expect(page.getByRole("list", { name: "Speaking requests" })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("streamer studio", () => {
  test("opening /studio lands straight on the console, no key asked", async ({ page }) => {
    await page.goto("/studio");
    await expect(page.getByRole("list", { name: "Speaking requests" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Streamer key")).toHaveCount(0);
  });

  test("Allow moves a speaker from the queue to the stage", async ({ page }) => {
    await openStudio(page);

    const requests = page.getByRole("list", { name: "Speaking requests" });
    await expect(requests.getByText("bleu_de_france")).toBeVisible({ timeout: 10_000 });
    await requests
      .getByRole("listitem")
      .filter({ hasText: "bleu_de_france" })
      .getByRole("button", { name: "Allow" })
      .click();

    const onStage = page.getByRole("list", { name: "On stage" });
    await expect(onStage.getByText("bleu_de_france")).toBeVisible({ timeout: 5_000 });
    await expect(requests.getByText("bleu_de_france")).toHaveCount(0);
    // The speaker counter follows presence:update (x/8).
    await expect(page.getByText("1/8", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("the capture source can be switched to screen share", async ({ page }) => {
    await openStudio(page);
    const source = page.getByLabel("Source", { exact: true });
    await expect(source).toHaveValue("camera");
    await source.selectOption("screen");
    await expect(source).toHaveValue("screen");
  });

  test("the OBS tab shows the ingest address and keeps the stream key hidden", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "OBS", exact: true }).click();

    const url = page.getByLabel("Ingest URL");
    await expect(url).toHaveValue("rtmp://mock.solocast.invalid:1935/x");
    // Stream key masked by default: it grants the right to publish.
    const key = page.getByLabel("Stream key");
    await expect(key).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(key).toHaveAttribute("type", "text");
    await expect(key).toHaveValue("mock-stream-key-not-real");
  });

  test("the console fits a desktop screen with no page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openStudio(page);
    await expect(page.getByRole("log", { name: "Chat messages" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("sharing panel (installed app)", () => {
  test("turns the public link on, copies it and can quit", async ({ page }) => {
    await openStudio(page);

    const panel = page.getByRole("region", { name: "Sharing" });
    await expect(panel.getByText("Sharing is off.")).toBeVisible();

    await panel.getByRole("button", { name: "Share", exact: true }).click();
    await expect(panel.getByLabel("Public link")).toHaveValue(/^https:\/\/.+trycloudflare\.com$/);
    await expect(panel.getByRole("button", { name: "Stop sharing" })).toBeVisible();

    await panel.getByRole("button", { name: "Quit SoloCast" }).click();
    await panel.getByRole("button", { name: "Stop SoloCast and the stream" }).click();
    await expect(page.getByText("SoloCast has stopped. You can close this tab.")).toBeVisible();
  });
});
