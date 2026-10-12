import type { TokenResponse } from "@solocast/shared";
import type { StageMedia, StageMediaHandlers } from "./media";

/** Média factice : aucune connexion réelle, aucun micro. Réservé au mode mock. */
export class MockStageMedia implements StageMedia {
  private handlers: StageMediaHandlers | null = null;

  connect(_token: TokenResponse, handlers: StageMediaHandlers): Promise<void> {
    this.handlers = handlers;
    return new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  }

  enableMicrophone(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    const handlers = this.handlers;
    this.handlers = null;
    handlers?.onDisconnected();
    return Promise.resolve();
  }
}
