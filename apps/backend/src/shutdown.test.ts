import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createShutdown", () => {
  it("ferme une seule fois et sort avec 0", async () => {
    const close = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    const shutdown = createShutdown({ close, exit, log: () => undefined });
    await shutdown("SIGTERM");
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("un second signal pendant la fermeture force la sortie immédiate (1)", async () => {
    const exit = vi.fn();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const shutdown = createShutdown({ close, exit, log: () => undefined });
    void shutdown("SIGTERM");
    await shutdown("SIGINT");
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("une fermeture en échec sort avec 1 sans promesse rejetée", async () => {
    const exit = vi.fn();
    const logs: string[] = [];
    const shutdown = createShutdown({
      close: () => Promise.reject(new TypeError("boom")),
      exit,
      log: (m) => logs.push(m),
    });
    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.join("\n")).toContain("TypeError");
  });

  it("une fermeture qui ne finit jamais est forcée après le délai", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createShutdown({
      close: () => new Promise<void>(() => undefined),
      exit,
      log: () => undefined,
      timeoutMs: 500,
    });
    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(501);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
