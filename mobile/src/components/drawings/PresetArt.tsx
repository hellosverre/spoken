import { Image } from "react-native";
import type { PresetIcon } from "../../lib/presets";
import type { Tint } from "../../lib/theme";

// Generated 3D illustrations for the presets (assets/presets, one per PresetIcon).
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

export function PresetArt({ icon, size = 56 }: { icon: PresetIcon; tint?: Tint; size?: number }) {
  return <Image source={ART[icon]} style={{ width: size, height: size }} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
