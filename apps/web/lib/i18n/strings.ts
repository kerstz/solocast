// Every user-visible string of the app. No literal copy inside components.
// English only (the whole UI is English).
// Nothing here states a fact the app cannot back with real data: counts, status and stream
// figures are passed in by the caller, never invented.

import { ROOM_NAME } from "@solocast/shared";

/** "1 viewer" / "12 viewers" / "— viewers" while presence is unknown. */
function viewersText(n: number | null): string {
  if (n === null) return "— viewers";
  return n === 1 ? "1 viewer" : `${String(n)} viewers`;
}

export const STRINGS = {
  brand: "SoloCast",
  window: {
    close: "Close",
    minimize: "Minimize",
    maximize: "Maximize",
    joinTitle: "SoloCast — Join",
    studioTitle: "SoloCast — Studio",
    /**
     * Titre de la fenêtre viewer. « LIVE » n'apparaît que quand le navigateur reçoit
     * réellement la piste : rien n'annonce un direct que la session ne peut pas prouver.
     */
    watchTitle: (live: boolean): string =>
      `SoloCast :: #${ROOM_NAME}${live ? " — LIVE" : " — off air"}`,
  },
  menu: {
    file: "File",
    view: "View",
    channel: "Channel",
    help: "?",
  },
  desk: {
    start: "Start",
    player: "SoloCast.exe",
    bin: "Recycle Bin",
    binTitle: "Recycle Bin (opens an external page)",
    clockLabel: "Clock",
    desktopLabel: "Desktop shortcuts",
  },
  join: {
    taskLabel: "Join",
    slogan: "» One channel. Live. Old school.",
    logoSubtitle: "single channel · live only, no replay",
    intro: "No account, no password. Pick a username and jump in.",
    usernameLabel: "Username",
    usernamePlaceholder: "e.g. Rad_Gamer92",
    hint: "3 to 24 characters: letters, digits, _ or -.",
    enter: "» Enter the live",
    entering: "Joining…",
    goLive: "» Open the studio (go live)",
    goLiveIntro: "You are the streamer? Open the studio — no key: whoever opens it takes the desk.",
    errors: {
      invalid_input: "Invalid username: 3 to 24 characters, letters, digits, _ or -.",
      network: "Cannot reach the server. Check that the backend is running.",
      rate_limited: "Too many attempts. Wait a moment.",
      server: "Server error. Try again in a moment.",
    },
  },
  studio: {
    taskLabel: "Studio",
    opening: "Opening the studio…",
    gate: {
      title: "SoloCast — Studio",
      retry: "» Try again",
      errors: {
        rate_limited: "Too many attempts. Wait a moment, then try again.",
        network: "Cannot reach the server. Check that the backend is running.",
        server: "Server error. Try again in a moment.",
      },
    },
    pageLabel: "Streamer control panel",
    back: "« Back to home",
    broadcastTitle: "Broadcast",
    countersTitle: "Counters",
    chatReadOnly: "Read-only. Moderation: Mute and Ban from the stage list.",
    modes: { obs: "OBS", browser: "Browser", label: "Broadcast mode" },
    obs: {
      intro:
        "In OBS: Settings, Stream, custom server, then paste the URL and key below. Requires the LiveKit Ingress service (docker compose up -d ingress).",
      url: "Ingest URL",
      key: "Stream key",
      copy: "Copy",
      copied: "Copied.",
      reveal: "Show",
      hide: "Hide",
      loading: "Asking the server for the ingest address…",
      retry: "Try again",
      hint: "Keep the stream key secret: it grants the right to publish on this channel.",
      errors: {
        forbidden: "The studio session expired. Reload the page.",
        server: "The LiveKit Ingress service did not answer. Start it, then try again.",
        network: "Cannot reach the server. Check that the backend is running.",
        rate_limited: "Too many requests. Wait a moment, then try again.",
      },
    },
    browser: {
      start: "Go live",
      stop: "Stop",
      starting: "Starting…",
      stopping: "Stopping…",
      preview: "Local preview",
      liveHint: (screen: boolean): string =>
        screen
          ? "Publishing the shared screen and microphone."
          : "Publishing camera and microphone.",
      idleHint: (screen: boolean): string =>
        screen
          ? "Off air. Press Go live to publish the shared screen and microphone."
          : "Off air. Press Go live to publish camera and microphone.",
      notice:
        "Resolution, FPS and bitrate apply on the fly. Simulcast and the capture source apply at the next start.",
    },
    broadcastErrors: {
      not_authorized: "The server did not authorize video and audio publishing.",
      mic_denied: "Camera or microphone denied by the browser. Allow them, then start again.",
      failed: "Broadcast could not start. Try again.",
      settings_failed: "That setting could not be applied on the fly.",
      lost: "The broadcast dropped. Start it again.",
    },
    settings: {
      title: "Capture settings",
      source: "Source",
      sourceCamera: "Camera",
      sourceScreen: "Screen share",
      camera: "Camera device",
      microphone: "Microphone",
      resolution: "Resolution",
      fps: "Frames/s",
      bitrate: "Max bitrate",
      simulcast: "Simulcast",
      on: "On",
      off: "Off",
      systemDefault: "System default",
      noDevice: "No device found",
      devicesBlocked: "Allow camera and microphone access to list devices.",
      refreshDevices: "Refresh devices",
      resolutionLabel: (r: number): string => `${String(r)}p`,
      bitrateLabel: (k: number): string => `${String(k)} kb/s`,
      notPersisted: "not persisted",
      applyLive: "applied live",
      applyNext: "applied at next start",
      applyFailed: "not applied",
    },
    counters: {
      viewers: "Viewers",
      speakers: "Speakers",
      live: "Live",
      liveOn: "ON AIR",
      liveOff: "OFFLINE",
      updatedAt: (s: number | null): string =>
        s === null ? "waiting for data" : `updated ${String(s)} s ago`,
    },
    scene: {
      title: "Stage",
      requests: "Speaking requests",
      requestsEmpty: "No pending request.",
      onStage: "On stage",
      onStageEmpty: "Nobody on stage.",
      grant: "Allow",
      revoke: "Mute",
      ban: "Ban",
      banConfirm: "Confirm ban",
      cancel: "Cancel",
      capReached: "Speaker limit reached: allow someone after a slot frees up.",
      failed: (action: string, pseudo: string): string => `Failed: ${action} ${pseudo}.`,
      actions: { grant: "allow", revoke: "mute", ban: "ban" },
      dismiss: "Dismiss message",
    },
    errors: {
      unauthorized: "Studio session refused.",
      forbidden: "Access denied.",
      rate_limited: "Too many attempts. Wait a moment.",
      network: "Cannot reach the server. Check that the backend is running.",
      server: "Server error. Try again in a moment.",
      invalid_input: "Invalid request.",
    },
  },
  player: {
    region: "Live player",
    video: "SoloCast live video",
    title: "SoloCast Player",
    channel: `#${ROOM_NAME}`,
    /** Scrolling banner. Live state and viewer count come from the server, never from a literal. */
    marquee: (live: boolean, viewers: number | null): string =>
      live
        ? `★ LIVE ★ #${ROOM_NAME} · ${viewersText(viewers)} connected ★ LIVE ★`
        : `#${ROOM_NAME} · off air · this page joins the stream on its own when it starts`,
    rec: "● REC LIVE",
    offline: "OFFLINE",
    loading: "LOADING…",
    offlineTitle: "The stream is not live",
    offlineHint: "Waiting for the streamer. This page reconnects by itself.",
    errorTitle: "Playback failed",
    errorHint: "This browser could not join the stream.",
    roomFullTitle: "The room is full",
    roomFullHint: "The streamer caps how many viewers can watch at once. This page keeps trying.",
    viewers: (n: number): string => viewersText(n),
    transport: "WebRTC",
    timeLabel: "Playback time",
    previous: "Previous (unavailable on live)",
    play: "Play",
    pause: "Pause",
    stop: "Stop",
    next: "Next (unavailable on live)",
    volume: "Volume",
    quality: "Quality",
    screen: "Screen",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    received: "Received",
    receivedNone: "—",
    onAirBanner: "ON AIR",
    onAirHint: "— your microphone is open. Be nice!",
    autoplayBlocked: "Press Play to start the stream.",
  },
  chat: {
    title: "Room chat",
    online: (n: number): string => `${String(n)} online`,
    log: "Chat messages",
    empty: "No message yet. Start the conversation!",
    placeholder: "Type your message...",
    inputLabel: "Message",
    send: "Send",
    slowMode: "Slow mode: 3 msg / 2 s",
    terminated: {
      room_full: "The room is full: the streamer caps how many viewers can join at once.",
      banned: "You were banned from this room: the chat is closed.",
      flood: "Chat closed for flooding. Reload the page to come back.",
      unauthorized: "Session expired: reload the page to come back to the chat.",
    },
    connectedAs: "connected as",
    prompt: "Pick a username to write in the chat.",
    promptLink: "Pick a username",
    connecting: "Connecting to the chat…",
    reconnecting: "Connection lost. Retrying…",
    closed: "Chat unavailable. Reload the page.",
    notSent: "Message not sent: the chat is disconnected.",
    streamerBadge: "STREAMER",
    newMessages: "See new messages",
    noticeLabel: "Chat notice",
    sentAt: (ts: number): string =>
      new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  },
  stage: {
    title: "Go on stage",
    intro: "ask the streamer to open your microphone.",
    request: "Ask to speak",
    requested: "Request sent…",
    busy: "Joining the stage…",
    leave: "Leave the stage (mute me)",
    loginHint: "Pick a username to ask for the microphone.",
    chatOffline: "The chat is disconnected. Requests are not possible right now.",
    requestingStatus: "Request sent. Waiting for the streamer.",
    mintingStatus: "Preparing your microphone…",
    connectingStatus: "Joining the stage…",
    publishingStatus: "Turning the microphone on. Allow it if the browser asks.",
    onAirStatus: "Your microphone is open. The streamer can mute you at any time.",
    stoppingStatus: "Leaving the stage…",
    dismiss: "Dismiss message",
    errors: {
      chat_unavailable: "The chat is not connected. Request not possible.",
      token_failed: "Could not get stage access. Try again.",
      not_granted: "The streamer did not allow you to speak.",
      mic_denied: "Microphone access denied. Allow it in the browser, then ask again.",
      media_failed: "Joining the stage failed. Try again.",
      leave_failed:
        "The chat is disconnected: your microphone is off, but the streamer was not told. Reload the page.",
    },
  },
  status: {
    connecting: "Joining the stream…",
    waiting: "Stream offline · waiting for the streamer",
    live: "Connected · WebRTC",
    error: "Connection lost · retrying",
    speakers: (count: number | null, max: number): string =>
      `${count === null ? "—" : String(count)}/${String(max)} on stage`,
    viewers: (n: number | null): string => viewersText(n),
  },
  room: {
    title: `Channel #${ROOM_NAME}`,
    viewersLabel: "Connected",
    chatLabel: "Chat",
    chatStatus: {
      idle: "waiting",
      connecting: "connecting",
      open: "online",
      reconnecting: "retrying",
      closed: "offline",
    },
  },
  page: {
    watchTitle: "Live — SoloCast",
    studioTitle: "Studio — SoloCast",
    joinTitle: "Join — SoloCast",
  },
  errors: {
    generic: "Something went wrong. Try again.",
  },
} as const;
