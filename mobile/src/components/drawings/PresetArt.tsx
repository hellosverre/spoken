import { Image } from "react-native";
import type { PresetIcon } from "../../lib/presets";
import type { Tint } from "../../lib/theme";
import { useTint } from "../Art";

// The flat preset icons (assets/presets, one per PresetIcon). Each is one colour, so
// it is drawn in its theme tint, which keeps the set colour-blind safe and readable
// in light and dark mode.
const ART: Record<PresetIcon, number> = {
  phone: require("../../../assets/presets/phone.png"),
  heart: require("../../../assets/presets/heart.png"),
  pizza: require("../../../assets/presets/pizza.png"),
  doctor: require("../../../assets/presets/doctor.png"),
  scissors: require("../../../assets/presets/scissors.png"),
  calendar: require("../../../assets/presets/calendar.png"),
  bag: require("../../../assets/presets/bag.png"),
  person: require("../../../assets/presets/person.png"),
};

export function hasPresetArt(icon: PresetIcon): boolean {
  return icon in ART;
}

export function PresetArt({ icon, tint, size = 56 }: { icon: PresetIcon; tint?: Tint; size?: number }) {
  const own = useTint(icon);
  return <Image source={ART[icon]} style={{ width: size, height: size, tintColor: (tint ?? own).fg }} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
