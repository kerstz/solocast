import { randomUUID } from "node:crypto";
import type { Report, ReportReason } from "@solocast/shared";

export const REPORT_QUEUE_MAX = 200;
export const REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewReport {
  messageId: string;
  reason: ReportReason;
  details: string | null;
  reporterId: string;
  message: Report["message"];
}

export interface ReportQueue {
  // Ajoute un signalement. Même signaleur + même message : un seul (renvoie false, rien d'ajouté).
  add(report: NewReport): boolean;
  // Plus ancien d'abord, hors entrées expirées.
  list(): Report[];
  // true si le signalement existait.
  dismiss(id: string): boolean;
}

export interface ReportQueueOptions {
  max?: number;
  ttlMs?: number;
  now?: () => number;
}

/**
 * File de signalements EN MÉMOIRE, bornée (les plus anciens sont évincés) et à durée de vie
 * limitée (7 jours). Elle est propre à un processus : elle suffit pour l'application installée
 * (une seule instance). Un déploiement multi-instances (Redis) devra la déplacer dans un
 * stockage partagé ; en attendant, chaque instance a sa propre file et les signalements sont
 * perdus au redémarrage. Aucune donnée n'est écrite dans les logs.
 */
export function createReportQueue(options: ReportQueueOptions = {}): ReportQueue {
  const max = options.max ?? REPORT_QUEUE_MAX;
  const ttlMs = options.ttlMs ?? REPORT_TTL_MS;
  const now = options.now ?? Date.now;
  let reports: Report[] = [];

  const prune = (): void => {
    const limit = now() - ttlMs;
    reports = reports.filter((report) => report.ts > limit);
  };

  return {
    add(input) {
      prune();
      const duplicate = reports.some(
        (report) => report.reporterId === input.reporterId && report.messageId === input.messageId,
      );
      if (duplicate) {
        return false;
      }
      reports.push({ id: randomUUID(), ts: now(), ...input });
      if (reports.length > max) {
        reports = reports.slice(-max);
      }
      return true;
    },
    list() {
      prune();
      return [...reports];
    },
    dismiss(id) {
      prune();
      const before = reports.length;
      reports = reports.filter((report) => report.id !== id);
      return reports.length !== before;
    },
  };
}
