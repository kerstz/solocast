import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMemoryChatServices, type ChatServices } from "../chat/services.js";
import { createReportQueue } from "../report/queue.js";
import { cookieFrom, createHarness, type Harness } from "../test/harness.js";

let harness: Harness;
let app: FastifyInstance;
let chat: ChatServices;

const MESSAGE_ID = "msg-1";

beforeEach(async () => {
  chat = createMemoryChatServices({ historySize: 50 });
  harness = await createHarness({}, { chat });
  app = harness.app;
  await app.ready();
  await chat.state.appendHistory({
    id: MESSAGE_ID,
    userId: "11111111-1111-4111-8111-111111111111",
    pseudo: "Troll",
    text: "bad words",
    ts: Date.now(),
    isStreamer: false,
  });
});
afterEach(async () => {
  await app.close();
});

async function newViewerCookie(): Promise<string> {
  const res = await app.inject({ method: "GET", url: "/api/me" });
  return `${harness.names.viewer}=${cookieFrom(res.headers["set-cookie"], harness.names.viewer)}`;
}

async function streamerCookie(): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/studio/open" });
  return `${harness.names.streamer}=${cookieFrom(res.headers["set-cookie"], harness.names.streamer)}`;
}

const report = (cookie: string | undefined, payload: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/report",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
    payload: payload as object,
  });

const list = (cookie: string | undefined) =>
  app.inject({
    method: "GET",
    url: "/api/moderation/reports",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });

describe("POST /api/report", () => {
  it("401 without a viewer identity", async () => {
    const res = await report(undefined, { messageId: MESSAGE_ID, reason: "spam" });
    expect(res.statusCode).toBe(401);
  });

  it("400 on invalid bodies (unknown reason, extra field, long details)", async () => {
    const cookie = await newViewerCookie();
    expect((await report(cookie, { messageId: MESSAGE_ID, reason: "nope" })).statusCode).toBe(400);
    expect(
      (await report(cookie, { messageId: MESSAGE_ID, reason: "spam", extra: 1 })).statusCode,
    ).toBe(400);
    expect(
      (await report(cookie, { messageId: MESSAGE_ID, reason: "spam", details: "x".repeat(301) }))
        .statusCode,
    ).toBe(400);
    expect((await report(cookie, { reason: "spam" })).statusCode).toBe(400);
  });

  it("204 and stores a copy of the message, no-store, nothing sensitive in logs", async () => {
    const cookie = await newViewerCookie();
    const res = await report(cookie, {
      messageId: MESSAGE_ID,
      reason: "harassment",
      details: "secret-details-xyz",
    });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers["cache-control"])).toBe("no-store");

    const listed = await list(await streamerCookie());
    expect(listed.statusCode).toBe(200);
    expect(String(listed.headers["cache-control"])).toBe("no-store");
    const body = JSON.parse(listed.body) as {
      reports: {
        reason: string;
        details: string | null;
        message: { pseudo: string; text: string } | null;
      }[];
    };
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({
      reason: "harassment",
      details: "secret-details-xyz",
      message: { pseudo: "Troll", text: "bad words" },
    });
    expect(harness.logs()).toContain("report.received");
    expect(harness.logs()).not.toContain("secret-details-xyz");
    expect(harness.logs()).not.toContain("bad words");
  });

  it("stores message null when it is not in the history", async () => {
    const cookie = await newViewerCookie();
    await report(cookie, { messageId: "unknown", reason: "other" });
    const body = JSON.parse((await list(await streamerCookie())).body) as {
      reports: { message: unknown; details: unknown }[];
    };
    expect(body.reports[0]?.message).toBeNull();
    expect(body.reports[0]?.details).toBeNull();
  });

  it("deduplicates same reporter + same message, but not another reporter", async () => {
    const first = await newViewerCookie();
    const second = await newViewerCookie();
    await report(first, { messageId: MESSAGE_ID, reason: "spam" });
    expect((await report(first, { messageId: MESSAGE_ID, reason: "illegal" })).statusCode).toBe(
      204,
    );
    await report(second, { messageId: MESSAGE_ID, reason: "spam" });
    const body = JSON.parse((await list(await streamerCookie())).body) as { reports: unknown[] };
    expect(body.reports).toHaveLength(2);
  });

  it("rate-limits at 10 per minute", async () => {
    const cookie = await newViewerCookie();
    const codes: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      codes.push(
        (await report(cookie, { messageId: `m-${String(index)}`, reason: "spam" })).statusCode,
      );
    }
    expect(codes.slice(0, 10).every((code) => code === 204)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("moderation report list", () => {
  it("is reserved to the streamer (403 for none and for a viewer)", async () => {
    expect((await list(undefined)).statusCode).toBe(403);
    expect((await list(await newViewerCookie())).statusCode).toBe(403);
    const dismiss = await app.inject({
      method: "POST",
      url: "/api/moderation/reports/abc/dismiss",
      headers: { cookie: await newViewerCookie() },
    });
    expect(dismiss.statusCode).toBe(403);
  });

  it("dismiss removes the report, then 404", async () => {
    await report(await newViewerCookie(), { messageId: MESSAGE_ID, reason: "spam" });
    const streamer = await streamerCookie();
    const body = JSON.parse((await list(streamer)).body) as { reports: { id: string }[] };
    const id = body.reports[0]?.id ?? "";
    const url = `/api/moderation/reports/${id}/dismiss`;
    const first = await app.inject({ method: "POST", url, headers: { cookie: streamer } });
    expect(first.statusCode).toBe(204);
    expect((JSON.parse((await list(streamer)).body) as { reports: unknown[] }).reports).toEqual([]);
    const again = await app.inject({ method: "POST", url, headers: { cookie: streamer } });
    expect(again.statusCode).toBe(404);
  });
});

describe("report queue", () => {
  const base = { reason: "spam", details: null, message: null } as const;

  it("is bounded: the oldest entries are evicted", () => {
    const queue = createReportQueue({ max: 3 });
    for (let index = 0; index < 5; index += 1) {
      queue.add({ ...base, messageId: `m${String(index)}`, reporterId: "r" });
    }
    expect(queue.list().map((item) => item.messageId)).toEqual(["m2", "m3", "m4"]);
  });

  it("drops entries older than the TTL", () => {
    let now = 1_000;
    const queue = createReportQueue({ ttlMs: 100, now: () => now });
    queue.add({ ...base, messageId: "a", reporterId: "r" });
    now += 101;
    expect(queue.list()).toEqual([]);
    expect(queue.add({ ...base, messageId: "a", reporterId: "r" })).toBe(true);
  });
});
