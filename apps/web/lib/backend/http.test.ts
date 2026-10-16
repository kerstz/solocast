import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpBackend, resolveErrorCode } from "./http";
import { ApiError } from "./types";

const cfg = { apiBaseUrl: "http://api.test", wsUrl: "ws://api.test/ws" };

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveErrorCode", () => {
  it("recognises studio_key_required only on 401", () => {
    expect(resolveErrorCode(401, { error: "studio_key_required" })).toBe("studio_key_required");
    expect(resolveErrorCode(401, { error: "other" })).toBe("unauthorized");
    expect(resolveErrorCode(401, undefined)).toBe("unauthorized");
    expect(resolveErrorCode(403, { error: "studio_key_required" })).toBe("forbidden");
  });
});

describe("http backend: studio key", () => {
  it("surfaces studio_key_required from the 401 body", async () => {
    stubFetch(Response.json({ error: "studio_key_required", message: "x" }, { status: 401 }));
    const err = await createHttpBackend(cfg)
      .openStudio()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "studio_key_required" });
  });

  it("sends the key in the JSON body only, never in the URL", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await createHttpBackend(cfg).openStudio("s3cret");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0] ?? ["", {}];
    expect(url).toBe("http://api.test/api/studio/open");
    expect(init.body).toBe(JSON.stringify({ key: "s3cret" }));
  });
});

describe("http backend: reports", () => {
  it("posts a valid report", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await createHttpBackend(cfg).reportMessage({ messageId: "m1", reason: "spam" });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0] ?? ["", {}];
    expect(url).toBe("http://api.test/api/report");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ messageId: "m1", reason: "spam" }));
  });

  it("rejects an invalid reason before any request", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await expect(
      createHttpBackend(cfg).reportMessage({ messageId: "m1", reason: "nope" as "spam" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 429 to rate_limited", async () => {
    stubFetch(new Response("{}", { status: 429 }));
    await expect(
      createHttpBackend(cfg).reportMessage({ messageId: "m1", reason: "spam" }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("lists reports through the shared schema", async () => {
    stubFetch(
      Response.json({
        reports: [
          {
            id: "r1",
            messageId: "m1",
            reason: "spam",
            details: null,
            ts: 1,
            reporterId: "u1",
            message: null,
          },
        ],
      }),
    );
    const reports = await createHttpBackend(cfg).listReports();
    expect(reports).toHaveLength(1);
  });

  it("dismisses by id", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await createHttpBackend(cfg).dismissReport("r 1");
    const calls = fetchMock.mock.calls as unknown as [string][];
    expect(calls[0]?.[0]).toBe("http://api.test/api/moderation/reports/r%201/dismiss");
  });
});
