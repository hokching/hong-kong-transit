import { inkFor, lineByCode } from "../lib/network.ts"

export function LineChip({ code }: { code: string }) {
  const line = lineByCode[code]
  if (!line) return null
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tracking-wide"
      style={{ background: line.color, color: inkFor(line.color) }}
    >
      {line.nameZh}
    </span>
  )
}
