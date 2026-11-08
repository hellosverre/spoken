import { type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { F, makeStyles, PAD } from "../lib/theme";

/** The voice picker's sheet: a native page sheet on iOS (swipe down), a full modal on Android. Close button top right. */
export function VoiceSheet({ visible, title, closeLabel, onClose, children }: {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose(): void;
  children: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal} accessibilityViewIsModal>
        <View style={[styles.head, Platform.OS === "android" && { paddingTop: insets.top + 8 }]}>
          <View style={styles.side} />
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
          <View style={[styles.side, styles.right]}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={8} style={styles.close}>
              <Text style={styles.closeText}>{closeLabel}</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((C) => ({
  modal: { flex: 1, backgroundColor: C.app },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  side: { width: 80 },
  right: { alignItems: "flex-end" },
  title: { flex: 1, textAlign: "center", fontFamily: F.semibold, fontSize: 16, color: C.ink },
  close: { minHeight: 44, justifyContent: "center" },
  closeText: { fontFamily: F.semibold, fontSize: 16, color: C.accent },
  body: { paddingHorizontal: PAD, paddingTop: 20 },
}));
