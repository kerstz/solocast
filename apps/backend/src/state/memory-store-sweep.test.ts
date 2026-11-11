import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryKeyValueStore } from "./key-value-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryKeyValueStore : balayage des clés expirées", () => {
  it("les clés expirées jamais relues sont retirées au fil des écritures", async () => {
    vi.useFakeTimers();
    const store = new MemoryKeyValueStore();
    for (let i = 0; i < 500; i += 1) await store.set(`viewerip:${String(i)}`, "x", 10);
    vi.advanceTimersByTime(11_000);
    for (let i = 0; i < 499; i += 1) await store.set(`keep:${String(i)}`, "x", 3_600);
    expect(store.size).toBe(999);
    await store.set("trigger", "x", 3_600);
    expect(store.size).toBe(500);
  });
});
