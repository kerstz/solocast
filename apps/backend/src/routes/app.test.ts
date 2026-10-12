import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppStatus } from "@solocast/shared";
import type { AppControl } from "../app-control.js";
import { cookieFrom, createHarness, type Harness } from "../test/harness.js";

function fakeControl() {
  let status: AppStatus = {
    version: "0.1.0",
    share: { state: "off", url: null },
    video: "ready",
    ingest: false,
    mediaPorts: { tcp: 7881, udp: 7882 },
  };
  const quit = vi.fn();
  const control: AppControl = {
    status: () => status,
    setShare: (enabled) => {
      status = {
        ...status,
        share: enabled
          ? { state: "on", url: "https://abc.trycloudflare.com" }
          : { state: "off", url: null },
      };
      return Promise.resolve();
    },
    quit,
  };
  return { control, quit };
}

describe("routes /api/app", () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    await harness?.app.close();
    harness = undefined;
  });

  async function openStudio(h: Harness): Promise<string> {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/studio/open",
      headers: { host: "localhost:8080" },
      payload: {},
    });
    return `${h.names.streamer}=${cookieFrom(res.headers["set-cookie"], h.names.streamer)}`;
  }

  it("refuse sans cookie studio", async () => {
    const { control } = fakeControl();
    harness = await createHarness({}, { appControl: control });
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/app/status",
      headers: { host: "localhost:8080" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuse depuis l'adresse publique, même avec le cookie studio", async () => {
    const { control } = fakeControl();
    harness = await createHarness({}, { appControl: control });
    const cookie = await openStudio(harness);
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/app/status",
      headers: { host: "abc.trycloudflare.com", cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("renvoie l'état, bascule le partage et arrête l'app", async () => {
    const { control, quit } = fakeControl();
    harness = await createHarness({}, { appControl: control });
    const cookie = await openStudio(harness);
    const headers = { host: "localhost:8080", cookie };

    const status = await harness.app.inject({ method: "GET", url: "/api/app/status", headers });
    expect(status.json()).toMatchObject({ share: { state: "off", url: null } });

    const shared = await harness.app.inject({
      method: "POST",
      url: "/api/app/share",
      headers,
      payload: { enabled: true },
    });
    expect(shared.json()).toMatchObject({
      share: { state: "on", url: "https://abc.trycloudflare.com" },
    });

    const bad = await harness.app.inject({
      method: "POST",
      url: "/api/app/share",
      headers,
      payload: { enabled: "oui" },
    });
    expect(bad.statusCode).toBe(400);

    const quitRes = await harness.app.inject({
      method: "POST",
      url: "/api/app/quit",
      headers,
      payload: {},
    });
    expect(quitRes.statusCode).toBe(204);
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledOnce();
    });
  });

  it("n'expose pas ces routes sans appControl", async () => {
    harness = await createHarness();
    const res = await harness.app.inject({ method: "GET", url: "/api/app/status" });
    expect(res.statusCode).toBe(404);
  });
});
