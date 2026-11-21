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

export function inkFor(color: string): string {
  const hex = color.replace("#", "")
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const brightness = red * 0.299 + green * 0.587 + blue * 0.114
  return brightness > 170 ? "#1c1917" : "#ffffff"
}
