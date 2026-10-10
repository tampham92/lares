import { z } from 'zod';

/*
 * Notification center (top bar bell). The server builds the list; the bell renders any kind the
 * same way, so a new kind (Pro license, a system notice...) needs no UI change.
 */

export type NotificationTone = 'info' | 'ok' | 'warn' | 'err';

export interface NotificationAction {
  label: string;
  /** Panel route ("/settings?tab=update") or, with `external`, a full https URL. */
  href: string;
  external?: boolean;
}

export interface PanelNotification {
  /**
   * Stable per content: "release:0.4.0", "isolation:12", "event:31". A new release gets a new id,
   * so it is unread again even if the previous one was read.
   */
  id: string;
  /** Source, for filtering and icons: release | isolation | event | pro | ... */
  kind: string;
  tone: NotificationTone;
  /** Already in the viewer's language. */
  title: string;
  body?: string;
  createdAt: string;
  actions?: NotificationAction[];
  /** A shell command shown with a copy button (e.g. the upgrade command). */
  command?: string;
  /** Stored events can be dismissed for everyone; live ones disappear when their condition ends. */
  dismissible: boolean;
}

export interface NotificationsResponse {
  items: PanelNotification[];
  /** ids among `items` this user has already seen. */
  read: string[];
}

export const notificationIdsSchema = z.object({ ids: z.array(z.string().min(1).max(100)).max(200) });
