// This phone's notifications, through the API's client route (packages/web-kit/web-push.ts); the service worker reads
// each alert and shows it (../../sw/alerts.ts).

import * as webPush from "@maneman/web-kit/web-push";
import { api } from "../api.ts";

export { notificationsHere, type OnThisPhone } from "@maneman/web-kit/web-push";

export const keepSubscription = (key: string): Promise<boolean> => webPush.keepSubscription(key, api.pushSubscribe);

export const turnOnNotifications = (key: string): Promise<webPush.OnThisPhone> =>
  webPush.turnOnNotifications(key, api.pushSubscribe);
