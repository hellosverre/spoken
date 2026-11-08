import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

/* A system notification when Spoken is waiting for the user: an approval during a call, or a
   question in the chat. In the app the sheet, buzz and flash already do this, so it only shows
   when the app isn't in front, including if the user leaves while Spoken is waiting.

   These are local notifications, so the phone's OS has to keep the app running to send them:
   during a real call keep-alive.ts does that. There's no push from the server (yet).

   An approval can carry its choices as buttons (Approve / Decline, or the offered times), so
   you can answer from the notification without opening the app. */

const CHANNEL = "spoken-needs-you";

export interface NotifyAction {
  id: string;
  label: string;
  destructive?: boolean;
}

let waiting: { title: string; body: string; category?: string } | null = null;
let shown: string | null = null;
let asked = false;
let onAction: ((id: string) => void) | null = null;
let categorySeq = 0;

async function show() {
  if (!waiting || shown) return;
  const { title, body, category } = waiting;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      // Time sensitive: an approval gets through Focus modes and notification summaries on iPhone
      // (needs the Time Sensitive Notifications capability; without it iOS treats it as active).
      content: { title, body, sound: true, interruptionLevel: "timeSensitive", ...(category ? { categoryIdentifier: category } : {}) },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
    });
    // Answered while it was being scheduled.
    if (waiting) shown = id;
    else await Notifications.dismissNotificationAsync(id);
  } catch {
    /* no permission or unsupported: the sheet and buzz are still there */
  }
}

function hide() {
  const id = shown;
  shown = null;
  if (id) Notifications.dismissNotificationAsync(id).catch(() => {});
}

/** Sets up the handler and watches the app going to and from the background. Call once at start. */
export function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  AppState.addEventListener("change", (state) => {
    if (state === "background") void show();
    else if (state === "active") hide();
  });
  // A button on the notification: answer without opening the app.
  Notifications.addNotificationResponseReceivedListener((res) => {
    const id = res.actionIdentifier;
    if (id && id !== Notifications.DEFAULT_ACTION_IDENTIFIER) onAction?.(id);
  });
}

/** Where a tapped notification button goes (the store answers the approval with it). */
export function onNotificationAction(fn: (id: string) => void) {
  onAction = fn;
}

/** Asks the OS for permission the first time it's useful: when a real call is being set up. */
export async function askNotificationPermission() {
  if (asked) return;
  asked = true;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: "Spoken needs you",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 120, 80, 120],
      });
    }
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== "granted" && canAskAgain) await Notifications.requestPermissionsAsync();
  } catch {
    /* the app works without notifications */
  }
}

/**
 * Spoken is waiting for the user. Shows now if the app is in the background, else if they leave.
 * `actions` become buttons on the notification; tapping one calls the onNotificationAction handler.
 */
export async function notifyNeedsYou(title: string, body: string, actions: NotifyAction[] = []) {
  hide();
  let category: string | undefined;
  if (actions.length) {
    // One category per approval: the buttons are that approval's own choices.
    category = `spoken-answer-${++categorySeq}`;
    try {
      await Notifications.setNotificationCategoryAsync(
        category,
        actions.map((a) => ({
          identifier: a.id,
          buttonTitle: a.label,
          options: { opensAppToForeground: false, isDestructive: !!a.destructive },
        })),
      );
    } catch {
      category = undefined; // plain notification, tapping it opens the app
    }
  }
  waiting = { title, body, category };
  if (AppState.currentState !== "active") void show();
}

/** A one-off notice (the call ended while you were away). Only when the app isn't in front. */
export function notifyOnce(title: string, body: string) {
  if (AppState.currentState === "active") return;
  Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
  }).catch(() => {});
}

/** The user answered, or there's nothing to answer any more. */
export function clearNeedsYou() {
  waiting = null;
  hide();
}
