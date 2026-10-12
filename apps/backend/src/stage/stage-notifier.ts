import type { CLIENT_EVENTS, SERVER_EVENTS } from "@solocast/shared";

// Port d'événements stage. L'implémentation WebSocket (WP3) enverra ces événements aux clients concernés.
export type StageNotification =
  | { event: typeof SERVER_EVENTS.STAGE_GRANTED; viewerId: string }
  | { event: typeof SERVER_EVENTS.STAGE_REVOKED; viewerId: string }
  | { event: typeof CLIENT_EVENTS.STAGE_REQUEST; viewerId: string; pseudo: string | null };

export interface StageNotifier {
  notify(notification: StageNotification): Promise<void>;
}

// Port no-op : conservé pour les tests ; en production c'est le hub WebSocket (WP3) qui notifie.
export const noopStageNotifier: StageNotifier = {
  notify: () => Promise.resolve(),
};
