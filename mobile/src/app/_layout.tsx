import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { ThemeProvider, useTheme } from "../lib/theme";
import { SpokenProvider } from "../lib/use-spoken";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const ready = loaded || !!error;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    <SpokenProvider>
      <ThemeProvider>
        <Themed />
      </ThemeProvider>
    </SpokenProvider>
  );
}

function Themed() {
  const { C, scheme } = useTheme();
  // The window behind the screens follows the theme, so transitions never flash the other colour.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(C.app).catch(() => {});
  }, [C.app]);
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.app } }} />
    </>
  );
}
