import { expect, test } from "@playwright/test";

// Mock mode (playwright.config.ts): no backend and no SFU needed. The fake server grants the
// stage ~1.5 s after a request, which is exactly what these tests assert: the viewer never
// opens their own microphone.

/** Home page: pick a username, land on /watch. */
async function enterLive(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Username").fill("xX_Dark_Viewer");
  await page.getByRole("button", { name: "» Enter the live" }).click();
  await expect(page).toHaveURL(/\/watch$/);
}

test.describe("viewer journey", () => {
  test("picking a username shows the player and the chat on /watch", async ({ page }) => {
    await enterLive(page);

    await expect(page.getByRole("region", { name: "Live player" })).toBeVisible();
    await expect(page.getByRole("log", { name: "Chat messages" })).toBeVisible();
    // Chat history served by the fake server, streamer badge included.
    await expect(page.getByText("thanks for being here tonight folks")).toBeVisible();
    await expect(page.getByText("STREAMER").first()).toBeVisible();
    // No stream is published in mock mode: the player stays off air.
    await expect(page.getByText("OFFLINE", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("asking to speak opens the mic only after the server grant, then leaving closes it", async ({
    page,
  }) => {
    await enterLive(page);

    const request = page.getByRole("button", { name: "Ask to speak" });
    await expect(request).toBeEnabled({ timeout: 15_000 });
    await request.click();

    // The grant arrives late on purpose: the stage is opened by the server, never by the client.
    const leave = page.getByRole("button", { name: /Leave the stage/ });
    await expect(leave).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ON AIR")).toBeVisible();

    await leave.click();
    await expect(page.getByRole("button", { name: "Ask to speak" })).toBeEnabled({
      timeout: 10_000,
    });
  });

  test("the chat is keyboard usable and sends a message", async ({ page }) => {
    await enterLive(page);

    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.focus();
    await page.keyboard.type("hello chat");
    await page.keyboard.press("Enter");
    await expect(page.getByText("hello chat")).toBeVisible();
  });
});
