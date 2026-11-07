import { useEffect, useRef, useState } from "react";
import { Keyboard, TextInput, View, type TextInputInstance } from "react-native";
import { em, F, makeStyles, useTheme } from "../lib/theme";
import { ContactsButton } from "./ContactPicker";
import { Icon } from "./Icon";
import { Press } from "./ui";

interface Props {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  placeholder: string;
  label: string;
  sendLabel: string;
  /** When this number changes, the input takes focus. */
  focusTick?: number;
}

/** Text field that grows with its content (up to 120 pt). Return sends. */
export function Composer({ value, onChange, onSubmit, placeholder, label, sendLabel, focusTick = 0 }: Props) {
  const { C, scheme } = useTheme();
  const styles = useStyles();
  const ref = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);

  // Focus only when the tick changes while mounted. Remounting (tab switch) with an old tick used to
  // re-focus the field, pop the keyboard up over a screen that never asked for it.
  const seenTick = useRef(focusTick);
  useEffect(() => {
    if (focusTick === seenTick.current) return;
    seenTick.current = focusTick;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [focusTick]);

  // Unmounting while focused (tab or screen change) leaves the keyboard up with no field: close it.
  useEffect(() => {
    const input = ref.current;
    return () => {
      if (input?.isFocused()) Keyboard.dismiss();
    };
  }, []);

  return (
    <View style={[styles.field, focused && { borderColor: C.accent }]}>
      <TextInput
        ref={ref}
        multiline
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.dim}
        accessibilityLabel={label}
        selectionColor={C.accent}
        cursorColor={C.accent}
        keyboardAppearance={scheme}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.input}
      />
      <ContactsButton onInsert={(t) => onChange(value.trim() ? `${value.trimEnd()} ${t}` : t)} />
      <Press accessibilityLabel={sendLabel} onPress={onSubmit} scale={0.92} style={styles.send}>
        <Icon name="send" color={C.inv} size={17} strokeWidth={2} />
      </Press>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingVertical: 5,
    paddingRight: 5,
    paddingLeft: 14,
    boxShadow: C.lift,
  },
  input: {
    flex: 1,
    minWidth: 0,
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
    fontFamily: F.regular,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: em(-0.006, 16),
    color: C.ink,
  },
  send: { width: 36, height: 36, borderRadius: 9, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
}));
