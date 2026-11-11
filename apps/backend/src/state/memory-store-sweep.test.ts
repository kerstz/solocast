import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryKeyValueStore } from "./key-value-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryKeyValueStore : balayage périodique", () => {
  it("retire les clés et les places expirées jamais relues, garde les vivantes", async () => {
    vi.useFakeTimers();
    const store = new MemoryKeyValueStore();
    for (let i = 0; i < 500; i += 1) await store.set(`viewerip:${String(i)}`, "x", 10);
    await store.set("keep", "x", 3_600);
    await store.takeSlot("stage:old", "a", 10, 8);
    await store.takeSlot("stage:live", "b", 3_600, 8);
    expect(store.size).toBe(501);
    expect(store.slotSetCount).toBe(2);
    await vi.advanceTimersByTimeAsync(MemoryKeyValueStore.SWEEP_INTERVAL_MS + 1);
    expect(store.size).toBe(1);
    expect(store.slotSetCount).toBe(1);
    expect(await store.hasSlot("stage:live", "b")).toBe(true);
  });
});
