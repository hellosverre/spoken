import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Platform } from "react-native";

/* Keeps the app running while a real call is on and you're in another app.

   The call itself runs on the server, but iOS freezes a backgrounded app within seconds:
   the live socket dies and nothing can tell you when Spoken needs your OK. Playing a silent
   loop with background audio enabled (the expo-audio plugin in app.json adds
   UIBackgroundModes "audio") keeps the app awake, so the socket stays up and the approval
   notification fires at once. It mixes with other audio, so your music keeps playing.

   This is a workaround that suits a personal build: App Store review rejects silent audio
   as a keep-alive. The lasting fix is server push (APNs), which needs a paid Apple account.
   On Android the lock-screen media controls keep playback, and so the app, alive. */

let player: AudioPlayer | null = null;

export async function startKeepAlive(label: { title: string; artist: string }) {
  if (player) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "mixWithOthers" });
    const p = createAudioPlayer(require("../../assets/audio/silence.wav"));
    p.loop = true;
    p.play();
    if (Platform.OS === "android") p.setActiveForLockScreen(true, label);
    player = p;
  } catch {
    /* Without it the call still runs on the server; the app catches up when you come back. */
  }
}

export function stopKeepAlive() {
  const p = player;
  player = null;
  if (!p) return;
  try {
    if (Platform.OS === "android") p.setActiveForLockScreen(false);
    p.pause();
    p.remove();
  } catch {}
  setAudioModeAsync({ shouldPlayInBackground: false }).catch(() => {});
}
