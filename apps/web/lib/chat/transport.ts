/** Transport minimal, injectable (tests et mock). Sans type DOM WebSocket pour rester découplé. */
export interface ChatTransport {
  send(data: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (code: number) => void): void;
}

/** Adaptateur WebSocket navigateur. Les données non textuelles sont ignorées. */
export function createBrowserTransport(url: string): ChatTransport {
  const ws = new WebSocket(url);
  let openHandler: (() => void) | undefined;
  let messageHandler: ((data: string) => void) | undefined;
  let closeHandler: ((code: number) => void) | undefined;

  ws.addEventListener("open", () => openHandler?.());
  ws.addEventListener("message", (ev: MessageEvent<unknown>) => {
    if (typeof ev.data === "string") messageHandler?.(ev.data);
  });
  ws.addEventListener("close", (ev: CloseEvent) => closeHandler?.(ev.code));

  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => {
      ws.close();
    },
    onOpen: (handler) => {
      openHandler = handler;
    },
    onMessage: (handler) => {
      messageHandler = handler;
    },
    onClose: (handler) => {
      closeHandler = handler;
    },
  };
}
