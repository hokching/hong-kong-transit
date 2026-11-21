import { lineByCode, stationByCode } from "../lib/network.ts"
import type { LiveTrain } from "../lib/useTrains.ts"

type Props = {
  train: LiveTrain
  lifted: boolean
  onClose: () => void
}

export function TrainCard({ train, lifted, onClose }: Props) {
  const line = lineByCode[train.line]
  const station = stationByCode[train.nextCode]
  return (
    <aside
      className={`fixed left-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-3xl border border-stone-300 bg-[#f7f4ee] p-3 shadow-xl ${
        lifted ? "bottom-[calc(48dvh+0.75rem)] md:bottom-6" : "bottom-4"
      } md:left-4`}
      role="dialog"
      aria-label="列車位置"
      data-testid="train-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.16em] text-stone-500 uppercase">{line?.nameZh ?? train.line}</p>
          <h2 className="text-xl font-bold">往{train.destName}</h2>
          <p className="text-sm text-stone-700">
            下一站 {station?.nameZh ?? train.nextName}
            {train.minutes <= 0 ? "，即將到達" : `，約 ${train.minutes} 分鐘`}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-stone-300 px-3 py-1 text-sm hover:bg-white"
          onClick={onClose}
        >
          關閉
        </button>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        {train.simulated ? "這班是沿路綫模擬的行走，不是即時位置。" : "位置按到站倒數估計，不是車載定位。"}
      </p>
    </aside>
  )
}
