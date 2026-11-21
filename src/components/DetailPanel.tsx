import { useEffect, useRef, useState } from "react"
import type { Camera } from "../lib/cameras.ts"
import { lineByCode, stationByCode } from "../lib/network.ts"
import { hongKongStamp, minutesUntil, type Schedule, type TrainInfo } from "../lib/schedule.ts"
import { LineChip } from "./LineChip.tsx"

export type LineQuery =
  | { status: "loading" }
  | { status: "ready"; schedule: Schedule }
  | { status: "limited" }
  | { status: "error" }

type Selection =
  | { kind: "station"; code: string }
  | { kind: "camera"; key: string }

type Props = {
  selection: Selection
  camera: Camera | null
  lineStates: Record<string, LineQuery>
  onClose: () => void
  onRetry: () => void
}

export function DetailPanel({ selection, camera, lineStates, onClose, onRetry }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const selectionKey = selection.kind === "station" ? selection.code : selection.key

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => {
      if (opener && document.contains(opener)) opener.focus()
      else document.querySelector<HTMLElement>("[data-testid=search]")?.focus()
    }
  }, [selectionKey])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[48dvh] flex-col rounded-t-3xl border border-stone-300 bg-[#f7f4ee] shadow-2xl md:inset-x-auto md:top-24 md:right-4 md:bottom-6 md:max-h-none md:w-[24rem] md:rounded-3xl"
      role="dialog"
      aria-label={selection.kind === "station" ? "到站班次" : "交通快拍"}
      data-testid={selection.kind === "station" ? "station-panel" : "camera-panel"}
    >
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div>
          {selection.kind === "station" ? (
            <StationHeading code={selection.code} />
          ) : (
            <CameraHeading camera={camera} />
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          className="rounded-full border border-stone-300 px-3 py-1 text-sm hover:bg-white"
          onClick={onClose}
        >
          關閉
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-3">
        {selection.kind === "station" ? (
          <StationBody code={selection.code} lineStates={lineStates} onRetry={onRetry} />
        ) : (
          <CameraBody camera={camera} />
        )}
      </div>
    </aside>
  )
}

function StationHeading({ code }: { code: string }) {
  const station = stationByCode[code]
  return (
    <>
      <p className="text-xs tracking-[0.16em] text-stone-500 uppercase">港鐵到站</p>
      <h2 className="text-2xl font-bold">{station?.nameZh ?? code}</h2>
      <p className="text-sm text-stone-600">{station?.nameEn}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {station?.lines.map((line) => (
          <LineChip key={line} code={line} />
        ))}
      </div>
    </>
  )
}

function StationBody({
  code,
  lineStates,
  onRetry,
}: {
  code: string
  lineStates: Record<string, LineQuery>
  onRetry: () => void
}) {
  const station = stationByCode[code]
  const failed = Object.values(lineStates).some(
    (state) => state.status === "error" || state.status === "limited",
  )
  return (
    <div className="space-y-4">
      {code === "RAC" && (
        <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
          馬場站通常只在賽馬日有列車。平日沒有班次是正常情況。
        </p>
      )}
      {station?.lines.map((line) => (
        <LineBlock key={line} code={line} query={lineStates[line]} />
      ))}
      {failed && (
        <button
          type="button"
          className="w-full rounded-full bg-[#1b2430] px-4 py-2 text-sm font-semibold text-white"
          onClick={onRetry}
        >
          重新查詢
        </button>
      )}
    </div>
  )
}

function LineBlock({ code, query }: { code: string; query: LineQuery | undefined }) {
  const line = lineByCode[code]
  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-3 py-3">
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: line?.color }} />
        {line?.nameZh ?? code}
      </h3>
      {!query || query.status === "loading" ? (
        <p className="text-sm text-stone-600">正在查詢到站班次…</p>
      ) : query.status === "limited" ? (
        <p className="text-sm text-stone-800">查詢太頻密，請稍後再試。</p>
      ) : query.status === "error" ? (
        <p className="text-sm text-stone-800">暫時連不到港鐵到站資料，請再試一次。</p>
      ) : (
        <ScheduleBody schedule={query.schedule} />
      )}
    </section>
  )
}

function ScheduleBody({ schedule }: { schedule: Schedule }) {
  const now = useNow()
  if (!schedule.ok) {
    return (
      <div className="space-y-2">
        <p className="text-sm">{schedule.alert ?? "暫時沒有這站的到站資料。"}</p>
        <SpecialLink url={schedule.specialUrl} />
      </div>
    )
  }
  const empty = schedule.directions.filter((direction) => direction.trains.length === 0).length
  return (
    <div className="space-y-2">
      {schedule.delayed && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">港鐵表示列車有延誤。</p>
      )}
      {schedule.alert && <p className="text-sm">{schedule.alert}</p>}
      {schedule.dataTime && (
        <p className="text-xs text-stone-500">資料時間 {schedule.dataTime}</p>
      )}
      {schedule.directions.flatMap((direction) =>
        direction.trains.map((train, index) => (
          <TrainRow key={`${direction.id}-${train.destCode}-${index}`} train={train} now={now} />
        )),
      )}
      {empty === 2 && <p className="text-sm">兩個方向暫時都沒有班次。</p>}
      {empty === 1 && <p className="text-sm text-stone-700">另一方向暫時沒有班次。</p>}
      <SpecialLink url={schedule.specialUrl} />
    </div>
  )
}

function SpecialLink({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <a className="inline-block text-sm font-semibold underline" href={url} target="_blank" rel="noreferrer">
      特別車務安排
    </a>
  )
}

function TrainRow({ train, now }: { train: TrainInfo; now: number }) {
  const minutes = train.arrivalAt ? minutesUntil(hongKongStamp(now), train.arrivalAt) : train.minutes
  return (
    <div className="flex items-start justify-between gap-3 border-t border-stone-100 py-2">
      <div>
        <p className="font-semibold">往{train.destName}</p>
        {train.platform && <p className="text-sm text-stone-600">月台 {train.platform}</p>}
      </div>
      <div className="text-right">
        <p className="font-semibold">{minutesLabel(minutes)}</p>
        {train.time && <p className="text-sm text-stone-500">{train.time}</p>}
      </div>
    </div>
  )
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function minutesLabel(minutes: number | null): string {
  if (minutes === null) return "時間未有"
  if (minutes <= 0) return "即將開出"
  return `約 ${minutes} 分鐘`
}

function CameraHeading({ camera }: { camera: Camera | null }) {
  return (
    <>
      <p className="text-xs tracking-[0.16em] text-stone-500 uppercase">交通快拍</p>
      <h2 className="text-xl leading-snug font-bold">{camera?.description ?? "快拍點"}</h2>
      {camera && (
        <p className="text-sm text-stone-600">
          {camera.region} · {camera.district}
        </p>
      )}
    </>
  )
}

function CameraBody({ camera }: { camera: Camera | null }) {
  if (!camera) {
    return <p className="text-sm">找不到這個快拍點。</p>
  }
  return (
    <div className="space-y-3">
      <Snapshot key={camera.url} url={camera.url} description={camera.description} />
      <p className="text-sm text-stone-600">
        運輸署約每兩分鐘發放新照片。下面顯示的是這次載入的畫面；若寫著「暫時未能提供服務」，表示這個快拍點目前沒有新照片。
      </p>
    </div>
  )
}

function Snapshot({ url, description }: { url: string; description: string }) {
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [src, setSrc] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setReloadToken((value) => value + 1), 120_000)
    return () => window.clearInterval(timer)
  }, [url])

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal })
        if (!response.ok) throw new Error(String(response.status))
        const blob = await response.blob()
        if (!blob.type.startsWith("image/")) throw new Error("not an image")
        objectUrl = URL.createObjectURL(blob)
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setSrc(objectUrl)
        setLoadedAt(hongKongStamp(Date.now()).slice(11, 16))
        setState("ready")
      } catch {
        if (controller.signal.aborted) return
        setState("error")
      }
    })()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [reloadToken, url])

  if (state === "error") {
    return (
      <p className="rounded-2xl bg-stone-100 px-3 py-6 text-center text-sm">
        此快拍點暫時未能提供照片。
      </p>
    )
  }
  if (state === "loading" || !src) {
    return <p className="text-sm text-stone-600">正在載入最新照片…</p>
  }
  return (
    <div className="space-y-2">
      <img
        src={src}
        alt={description}
        width={320}
        height={240}
        className="w-full rounded-2xl bg-stone-200"
        onError={() => setState("error")}
      />
      <div className="flex items-center justify-between gap-3 text-sm text-stone-600">
        <p>{loadedAt ? `這張照片於 ${loadedAt} 載入` : "正在顯示這次載入的照片"}</p>
        <button
          type="button"
          className="rounded-full border border-stone-300 px-3 py-1 hover:bg-white"
          onClick={() => setReloadToken((value) => value + 1)}
        >
          重新載入
        </button>
      </div>
    </div>
  )
}
