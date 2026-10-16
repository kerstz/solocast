import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../backend/types";
import { openStudioWith } from "./openStudio";

const streamerMe = {
  role: "streamer",
  viewerId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  pseudo: null,
} as const;

describe("openStudioWith", () => {
  it("skips open when the studio cookie is already there", async () => {
    const openStudio = vi.fn(() => Promise.resolve());
    const result = await openStudioWith({ getMe: () => Promise.resolve(streamerMe), openStudio });
    expect(result).toBe("open");
    expect(openStudio).not.toHaveBeenCalled();
  });

  it("opens without a key first", async () => {
    const openStudio = vi.fn((_key?: string) => Promise.resolve());
    const result = await openStudioWith({ getMe: () => Promise.resolve(null), openStudio });
    expect(result).toBe("open");
    expect(openStudio).toHaveBeenCalledWith();
  });

  it("asks for the key on studio_key_required, then sends it", async () => {
    const openStudio = vi.fn((key?: string) =>
      key === "good" ? Promise.resolve() : Promise.reject(new ApiError(401, "studio_key_required")),
    );
    const backend = { getMe: () => Promise.resolve(null), openStudio };
    expect(await openStudioWith(backend)).toBe("key_required");
    expect(await openStudioWith(backend, "bad")).toBe("key_required");
    expect(await openStudioWith(backend, "good")).toBe("open");
    expect(openStudio).toHaveBeenLastCalledWith("good");
  });

  it("rethrows other errors", async () => {
    const backend = {
      getMe: () => Promise.resolve(null),
      openStudio: () => Promise.reject(new ApiError(403, "forbidden")),
    };
    await expect(openStudioWith(backend)).rejects.toMatchObject({ code: "forbidden" });
  });
});
