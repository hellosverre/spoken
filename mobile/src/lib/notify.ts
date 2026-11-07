import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

/* A system notification when Spoken is waiting for the user: an approval during a call, or a
   question in the chat. In the app the sheet, buzz and flash already do this, so it only shows
   when the app isn't in front, including if the user leaves while Spoken is waiting.

   These are local notifications, so the phone's OS has to keep the app running to send them.
   There's no push from the server (yet). */

const CHANNEL = "spoken-needs-you";

let waiting: { title: string; body: string } | null = null;
let shown: string | null = null;
let asked = false;

async function show() {
  if (!waiting || shown) return;
  const { title, body } = waiting;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
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

/** Spoken is waiting for the user. Shows now if the app is in the background, else if they leave. */
export function notifyNeedsYou(title: string, body: string) {
  hide();
  waiting = { title, body };
  if (AppState.currentState !== "active") void show();
}

/** The user answered, or there's nothing to answer any more. */
export function clearNeedsYou() {
  waiting = null;
  hide();
}
