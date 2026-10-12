import { describe, expect, it } from "vitest";
import {
  changedSettings,
  DEFAULT_STREAM_SETTINGS,
  resolutionDimensions,
  restoreSettings,
  serializeSettings,
  SETTING_APPLY_MODE,
  setStreamSetting,
} from "./settings";

describe("réglages studio : état et validation", () => {
  it("part des valeurs par défaut (caméra, 1080p60, débit 6000, simulcast on)", () => {
    expect(DEFAULT_STREAM_SETTINGS).toEqual({
      source: "camera",
      cameraId: null,
      microphoneId: null,
      resolution: 1080,
      fps: 60,
      maxBitrateKbps: 6000,
      simulcast: true,
    });
  });

  it("accepte une valeur autorisée et renvoie un NOUVEL objet (pas de mutation)", () => {
    const next = setStreamSetting(DEFAULT_STREAM_SETTINGS, "resolution", "720");
    expect(next?.resolution).toBe(720);
    expect(DEFAULT_STREAM_SETTINGS.resolution).toBe(1080);
  });

  it("refuse une valeur hors liste (aucun état changé)", () => {
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "resolution", "4320")).toBeNull();
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "fps", "120")).toBeNull();
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "maxBitrateKbps", "99999")).toBeNull();
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "simulcast", "peut-être")).toBeNull();
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "source", "webcam")).toBeNull();
  });

  it("la source accepte caméra et partage d'écran", () => {
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "source", "screen")?.source).toBe("screen");
  });

  it("les identifiants de périphérique : chaîne vide = défaut système", () => {
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "cameraId", "cam-1")?.cameraId).toBe("cam-1");
    expect(
      setStreamSetting({ ...DEFAULT_STREAM_SETTINGS, microphoneId: "mic-1" }, "microphoneId", "")
        ?.microphoneId,
    ).toBeNull();
  });

  it("le simulcast se lit en on/off", () => {
    expect(setStreamSetting(DEFAULT_STREAM_SETTINGS, "simulcast", "off")?.simulcast).toBe(false);
    expect(
      setStreamSetting({ ...DEFAULT_STREAM_SETTINGS, simulcast: false }, "simulcast", "on")
        ?.simulcast,
    ).toBe(true);
  });

  it("calcule les dimensions de chaque résolution", () => {
    expect(resolutionDimensions(1080)).toEqual({ width: 1920, height: 1080 });
    expect(resolutionDimensions(720)).toEqual({ width: 1280, height: 720 });
    expect(resolutionDimensions(480)).toEqual({ width: 854, height: 480 });
  });

  it("n'annonce 'live' que pour les réglages applicables à chaud", () => {
    expect(SETTING_APPLY_MODE.resolution).toBe("live");
    expect(SETTING_APPLY_MODE.fps).toBe("live");
    expect(SETTING_APPLY_MODE.maxBitrateKbps).toBe("live");
    expect(SETTING_APPLY_MODE.cameraId).toBe("live");
    expect(SETTING_APPLY_MODE.microphoneId).toBe("live");
    expect(SETTING_APPLY_MODE.simulcast).toBe("next_start");
    expect(SETTING_APPLY_MODE.source).toBe("next_start");
  });

  it("changedSettings ne liste que les clés réellement modifiées", () => {
    const next = setStreamSetting(DEFAULT_STREAM_SETTINGS, "fps", "30");
    expect(next).not.toBeNull();
    expect(changedSettings(DEFAULT_STREAM_SETTINGS, next ?? DEFAULT_STREAM_SETTINGS)).toEqual([
      "fps",
    ]);
    expect(changedSettings(DEFAULT_STREAM_SETTINGS, DEFAULT_STREAM_SETTINGS)).toEqual([]);
  });
});

describe("persistance des réglages", () => {
  it("restaure ce qui a été sérialisé, sans les périphériques", () => {
    const custom = {
      ...DEFAULT_STREAM_SETTINGS,
      resolution: 720 as const,
      simulcast: false,
      cameraId: "cam-1",
    };
    const restored = restoreSettings(serializeSettings(custom));
    expect(restored.resolution).toBe(720);
    expect(restored.simulcast).toBe(false);
    expect(restored.cameraId).toBeNull();
  });

  it("retombe sur les valeurs par défaut si le contenu est invalide", () => {
    expect(restoreSettings(null)).toEqual(DEFAULT_STREAM_SETTINGS);
    expect(restoreSettings("pas du json")).toEqual(DEFAULT_STREAM_SETTINGS);
    expect(restoreSettings(JSON.stringify({ resolution: "9999", fps: 61 }))).toEqual(
      DEFAULT_STREAM_SETTINGS,
    );
  });
});
