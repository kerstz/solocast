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
    privacyLink: "Privacy",
    goLive: "» Open the studio (go live)",
    goLiveIntro: "You are the streamer? Open the studio — no key: whoever opens it takes the desk.",
    errors: {
      invalid_input: "Invalid username: 3 to 24 characters, letters, digits, _ or -.",
      network: "Cannot reach SoloCast. Check that it is still open on the streamer's computer.",
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
      keyIntro: "This studio is protected. Enter the studio key to open it.",
      keyLabel: "Studio key",
      keySubmit: "» Open the studio",
      keyChecking: "Checking…",
      keyWrong: "Wrong studio key.",
      errors: {
        rate_limited: "Too many attempts. Wait a moment, then try again.",
        forbidden: "The studio only opens on the computer that runs SoloCast.",
        network: "Cannot reach SoloCast. Check that it is still open on the streamer's computer.",
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
      intro: "In OBS: Settings, Stream, custom server, then paste the URL and key below.",
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
        server: "The OBS ingest service did not answer. Try again in a moment.",
        network: "Cannot reach SoloCast. Check that it is still open on the streamer's computer.",
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
      sfu_unavailable:
        "The video server is not running, so you cannot go live. Quit SoloCast and open it again.",
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
      saved: "saved on this computer",
      applyLive: "applied live",
      applyNext: "applied at next start",
      applyFailed: "not applied",
    },
    app: {
      title: "Sharing",
      shareLabel: "Public link",
      off: "Sharing is off. Only this computer can open SoloCast.",
      starting: "Opening the public link…",
      on: "Anyone with this link can watch and chat. Only this computer can open the studio.",
      unavailable:
        "The public link is not available. Check the internet connection, then press Share again.",
      missing: "Sharing is not included in this copy of SoloCast.",
      enable: "Share",
      disable: "Stop sharing",
      copy: "Copy link",
      copied: "Copied.",
      linkChanges: "The link changes every time sharing is turned on.",
      videoStarting: "The video server is starting. You can already open the studio.",
      noVideoTitle: "Video is not available",
      noVideo:
        "The video server did not start (or is not installed with this copy of SoloCast): chat only. Details are in the log file.",
      ports: (tcp: number, udp: number): string =>
        `Chat works for everyone with the link. For viewers outside your home network to receive video, open TCP ${String(tcp)} and UDP ${String(udp)} on your router and send them to this computer. This is not possible on every connection (mobile data, some providers).`,
      quit: "Quit SoloCast",
      quitConfirm: "Stop SoloCast and the stream",
      quitCancel: "Cancel",
      quitWarning: "Stopping SoloCast ends the broadcast for everyone.",
      stopped: "SoloCast has stopped. You can close this tab.",
      version: (v: string): string => `Version ${v}`,
      errors: {
        forbidden: "The studio was opened in another window. Reload to take it back here.",
        network: "Cannot reach SoloCast. It may have stopped.",
        server: "Something went wrong. Try again.",
        rate_limited: "Too many attempts. Wait a moment.",
      },
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
    reports: {
      title: "Reports",
      empty: "No pending report.",
      intro:
        "Messages reported by viewers. Dismiss a report once handled. To block someone, use Ban in the Stage panel: it already exists.",
      dismiss: "Dismiss",
      dismissLabel: (reason: string, pseudo: string | null): string =>
        pseudo === null ? `Dismiss ${reason} report` : `Dismiss ${reason} report about ${pseudo}`,
      list: "Pending reports",
      reasons: {
        spam: "Spam",
        harassment: "Harassment",
        illegal: "Illegal content",
        other: "Other",
      },
      messageGone: "(message no longer in the chat history)",
      details: "Details",
      failed: "Could not update the reports. Try again.",
      reportedBy: "reported at",
      at: (ts: number): string =>
        new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    },
    errors: {
      unauthorized: "Studio session refused.",
      forbidden: "Access denied.",
      rate_limited: "Too many attempts. Wait a moment.",
      network: "Cannot reach SoloCast. Check that it is still open on the streamer's computer.",
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
    noVideoTitle: "Video is not available right now",
    noVideoHint:
      "The streamer's video server is not reachable (SoloCast may be closed). The chat still works, and this page keeps trying.",
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
    report: {
      button: "Report",
      buttonLabel: (pseudo: string): string => `Report a message from ${pseudo}`,
      choose: "Why are you reporting this message?",
      reasons: {
        spam: "Spam",
        harassment: "Harassment",
        illegal: "Illegal content",
        other: "Other",
      },
      cancel: "Cancel",
      sending: "Sending…",
      done: "Reported. Thank you.",
      errors: {
        rate_limited: "Too many reports. Wait a moment.",
        unauthorized: "Session expired: reload the page.",
        forbidden: "You cannot report messages.",
        network: "Cannot reach SoloCast.",
        server: "Report not sent. Try again.",
      },
    },
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
    privacyTitle: "Privacy — SoloCast",
  },
  privacy: {
    link: "Privacy",
    windowTitle: "SoloCast — Privacy",
    taskLabel: "Privacy",
    backHome: "« Back to home",
    backWatch: "« Back to the stream",
    draftNotice:
      "This text is a template. It must be reviewed and validated before being relied on as a legal notice.",
    sections: [
      {
        title: "Who is responsible",
        paragraphs: [
          "SoloCast is software run by an individual streamer on their own computer. The streamer who shares the link to this page decides why and how your data is used here: they are the controller.",
          "Streamer contact: [streamer contact — to be filled in by the streamer].",
        ],
      },
      {
        title: "What data is processed",
        items: [
          "The username you pick (a label, not an account).",
          "A random session identifier, stored in a cookie so the server recognises your browser. It is not linked to your real identity.",
          "The messages you write in the chat, shown to everyone in the room and to the streamer.",
          "Your voice, only if you ask to speak and the streamer lets you on stage.",
          "Your IP address, used for anti-abuse (rate limiting, a cap on simultaneous connections). It is not written to the logs. A keyed hash (HMAC) of it, never the address itself, is kept with your session so that a ban can also cover your connection.",
          "Reports you send about a chat message: the reason, an optional short comment, and a copy of the reported message.",
        ],
      },
      {
        title: "How long it is kept",
        items: [
          "Session cookie: removed when you close the browser.",
          "Access token: valid 24 hours.",
          "Chat history: limited to the most recent messages and to 24 hours by default; in the installed app it is kept in memory only and disappears when SoloCast stops.",
          "Reports: kept 7 days at most, then deleted.",
          "Keyed hash of your IP: 24 hours. If you are banned, it stays blocked for 24 hours at most by default (the ban of your session itself may last longer).",
        ],
      },
      {
        title: "Who receives it",
        items: [
          "The streamer, who sees the chat, the reports and who is on stage.",
          "Cloudflare, only as a network carrier, if the streamer shares the stream through the public trycloudflare link: your requests pass through its network.",
        ],
      },
      {
        title: "No recording",
        paragraphs: [
          "SoloCast does not record video or audio. Nothing is stored about the stream itself. The streamer could still record it with their own tools: ask them.",
        ],
      },
      {
        title: "Your rights",
        paragraphs: [
          "Under the GDPR you can ask the streamer for access to, correction of, or deletion of your data, object to its processing, or restrict it. Because the data is short-lived and not tied to an account, closing the browser and waiting for the retention periods above removes most of it. You can also complain to your data protection authority (in France, the CNIL).",
          "To exercise your rights, contact the streamer: [streamer contact — to be filled in by the streamer].",
        ],
      },
    ],
  },
  errors: {
    generic: "Something went wrong. Try again.",
  },
} as const;
