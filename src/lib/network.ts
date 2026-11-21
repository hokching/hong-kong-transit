import {
  lines,
  stations,
  type LineRecord,
  type StationRecord,
} from "../data/mtr-network.ts"

export type { LineRecord, StationRecord }
export { lines, stations }

export const stationByCode: Record<string, StationRecord> = Object.fromEntries(
  stations.map((station) => [station.code, station]),
)

export const lineByCode: Record<string, LineRecord> = Object.fromEntries(
  lines.map((line) => [line.code, line]),
)

export function stationName(code: string): string {
  return stationByCode[code]?.nameZh ?? code
}

const DARK_INK = "#000000"
const LIGHT_INK = "#ffffff"

export function inkFor(color: string): string {
  const hex = color.replace("#", "")
  return contrast(hex, DARK_INK) >= contrast(hex, LIGHT_INK) ? DARK_INK : LIGHT_INK
}

function contrast(background: string, ink: string): number {
  const lighter = Math.max(relativeLuminance(background), relativeLuminance(ink))
  const darker = Math.min(relativeLuminance(background), relativeLuminance(ink))
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(hex: string): number {
  const digits = hex.replace("#", "")
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(digits.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
