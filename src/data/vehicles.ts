/** Vehicle scenarios for the power estimate (Instructions §23). VERIFIED values cite NASA sources; everything
 *  else is an explicit, user-editable ASSUMPTION and the UI badges it as such. */
import type { Vehicle } from "../types";

export function vehiclePresets(): Vehicle[] {
  return [
    {
      id: "viper",
      name: "VIPER-class rover",
      basis: "verified",
      panels: [
        { azOffsetDeg: 90, watts: 320 },
        { azOffsetDeg: 180, watts: 320 },
        { azOffsetDeg: 270, watts: 320 },
      ],
      batteryWh: 5420,
      baseLoadW: 250,
      hibernateW: 100,
      reservePct: 20,
      notes: "Three vertical arrays (port, starboard, aft). Battery and array ratings from NASA; loads are our assumptions.",
      sources: [
        { label: "Battery", value: "5,420 Wh", prov: "verified" },
        { label: "Arrays", value: "3 × 320 W, vertical", prov: "verified" },
        { label: "Low-power survival", value: "50 h", prov: "verified" },
        { label: "Hibernation load", value: "≤ 108 W (5,420 Wh ÷ 50 h)", prov: "computed" },
        { label: "Operating load", value: "250 W", prov: "assumption" },
        { label: "Usable reserve", value: "20 %", prov: "assumption" },
      ],
    },
    {
      id: "novac",
      name: "Nova-C-like lander",
      basis: "assumption",
      panels: [
        { azOffsetDeg: 90, watts: 80 },
        { azOffsetDeg: 270, watts: 80 },
        { azOffsetDeg: 0, watts: 40 },
      ],
      batteryWh: 700,
      baseLoadW: 120,
      hibernateW: 40,
      reservePct: 15,
      notes: "Assumption-based scenario. Only the 200 W total and a 25 Ah / 28 V battery appear in secondary sources.",
      sources: [
        { label: "Arrays", value: "200 W total (split assumed)", prov: "assumption" },
        { label: "Battery", value: "≈ 700 Wh", prov: "assumption" },
        { label: "Loads", value: "120 W / 40 W", prov: "assumption" },
      ],
    },
    {
      id: "blueghost",
      name: "Blue-Ghost-like lander",
      basis: "assumption",
      panels: [
        { azOffsetDeg: 90, watts: 160 },
        { azOffsetDeg: 270, watts: 160 },
        { azOffsetDeg: 0, watts: 80 },
      ],
      batteryWh: 1500,
      baseLoadW: 180,
      hibernateW: 60,
      reservePct: 15,
      notes: "Assumption-based scenario. Firefly states up to 400 W; the battery size is not public.",
      sources: [
        { label: "Arrays", value: "up to 400 W", prov: "verified" },
        { label: "Battery", value: "1,500 Wh", prov: "assumption" },
        { label: "Loads", value: "180 W / 60 W", prov: "assumption" },
      ],
    },
  ];
}
