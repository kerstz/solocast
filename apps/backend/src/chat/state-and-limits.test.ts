import { describe, expect, it } from "vitest";
import { createMemorySlidingWindowLimiter } from "./rate-limit.js";
import { createMemoryChatState } from "./state.js";
import { sleep } from "../test/ws-harness.js";

const message = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  userId: "6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6",
  pseudo: "alice",
  text: `msg ${String(n)}`,
  ts: n,
  isStreamer: false,
});

describe("historique capé (mémoire)", () => {
  it("ne garde que les N derniers, du plus ancien au plus récent", async () => {
    const state = createMemoryChatState({ historySize: 2 });
    await state.appendHistory(message(1));
    await state.appendHistory(message(2));
    await state.appendHistory(message(3));
    const history = await state.recentHistory();
    expect(history.map((m) => m.text)).toEqual(["msg 2", "msg 3"]);
  });
});

describe("présence et liens streameur (mémoire)", () => {
  it("expire après le TTL et ignore les clés périmées", async () => {
    const state = createMemoryChatState({ historySize: 10 });
    await state.touchPresence("6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6", "alice", 0);
    await state.touchPresence("7f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6", "bobby", 60);
    expect((await state.listPresence()).map((e) => e.pseudo)).toEqual(["bobby"]);
    await state.touchStreamerLink("sfu", 0);
    expect(await state.hasStreamerLink("sfu")).toBe(false);
    await state.touchStreamerLink("sfu", 60);
    expect(await state.hasStreamerLink("sfu")).toBe(true);
    await state.removeStreamerLink("sfu");
    expect(await state.hasStreamerLink("sfu")).toBe(false);
  });
});

describe("rate-limit fenêtre glissante (mémoire)", () => {
  it("accepte 3 actions par fenêtre, refuse la 4e, et un rejet n'allonge pas la fenêtre", async () => {
    const limiter = createMemorySlidingWindowLimiter();
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await limiter.hit("k", 3, 100));
    }
    expect(results).toEqual([true, true, true, false]);
    await sleep(110);
    expect(await limiter.hit("k", 3, 100)).toBe(true);
  });

  it("isole les clés (un viewer ne consomme pas le quota d'un autre)", async () => {
    const limiter = createMemorySlidingWindowLimiter();
    await limiter.hit("a", 1, 1000);
    expect(await limiter.hit("a", 1, 1000)).toBe(false);
    expect(await limiter.hit("b", 1, 1000)).toBe(true);
  });
});
