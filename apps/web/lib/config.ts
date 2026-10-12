import { z } from "zod";

const AppConfigSchema = z.object({
  mode: z.enum(["http", "mock"]),
  apiBaseUrl: z.string().regex(/^(https?:\/\/\S+)?$/, "NEXT_PUBLIC_API_BASE_URL is invalid"),
  // Absolute (ws://host/ws) or same-origin path (/ws). The share tunnel uses the path form:
  // page and socket share one origin, so the session cookie travels with the handshake.
  wsUrl: z
    .string()
    .regex(
      /^(wss?:\/\/\S+|\/\S*)$/,
      "NEXT_PUBLIC_WS_URL must be ws://…, wss://… or a same-origin path like /ws",
    ),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Public variables only: no secret ever reaches the browser. */
export interface RawPublicEnv {
  NEXT_PUBLIC_BACKEND_MODE?: string | undefined;
  NEXT_PUBLIC_API_BASE_URL?: string | undefined;
  NEXT_PUBLIC_WS_URL?: string | undefined;
  NODE_ENV?: string | undefined;
}

/**
 * Reads and validates the public configuration. Pure (testable).
 * `mock` is rejected in a production build: no fake backend may ship to production.
 */
export function readConfig(raw: RawPublicEnv): AppConfig {
  const config = AppConfigSchema.parse({
    mode: raw.NEXT_PUBLIC_BACKEND_MODE ?? "http",
    apiBaseUrl: (raw.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    wsUrl: raw.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3000/ws",
  });

  if (config.mode === "mock" && raw.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_BACKEND_MODE=mock is forbidden in production");
  }
  return config;
}

// Literal process.env access: Next inlines these references at build time.
export const config: AppConfig = readConfig({
  NEXT_PUBLIC_BACKEND_MODE: process.env.NEXT_PUBLIC_BACKEND_MODE,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  NODE_ENV: process.env.NODE_ENV,
});
