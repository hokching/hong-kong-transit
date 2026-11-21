import { useMemo, useState } from "react"
import type { Camera } from "../lib/cameras.ts"
import { stations } from "../lib/network.ts"
import type { StationPlace } from "../lib/places.ts"
import { LineChip } from "./LineChip.tsx"

type Props = {
  showLines: boolean
  showCameras: boolean
  onToggleLines: () => void
  onToggleCameras: () => void
  placesStatus: string
  cameraStatus: string
  missingStations: string[]
  places: StationPlace[] | null
  cameras: Camera[] | null
  onPickStation: (code: string) => void
  onPickCamera: (key: string) => void
  cameraCount: number | null
}

export function Chrome({
  showLines,
  showCameras,
  onToggleLines,
  onToggleCameras,
  placesStatus,
  cameraStatus,
  missingStations,
  places,
  cameras,
  onPickStation,
  onPickCamera,
  cameraCount,
}: Props) {
  const [query, setQuery] = useState("")
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return []
    return stations
      .filter(
        (station) =>
          station.nameZh.includes(query.trim()) || station.nameEn.toLowerCase().includes(text),
      )
      .slice(0, 8)
  }, [query])
  const cameraMatches = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text || !cameras) return []
    return cameras
      .filter(
        (camera) =>
          camera.key.toLowerCase().includes(text) ||
          camera.description.toLowerCase().includes(text) ||
          camera.district.includes(query.trim()) ||
          camera.region.includes(query.trim()),
      )
      .slice(0, 8)
  }, [cameras, query])

  return (
    <>
      <header className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex flex-col gap-2 md:right-auto md:max-w-md">
        <div className="pointer-events-auto rounded-3xl border border-stone-300 bg-[#f7f4ee]/95 p-3 shadow-lg backdrop-blur">
          <p className="text-xs tracking-[0.18em] text-stone-500">香港</p>
          <h1 className="text-2xl font-bold tracking-tight">交通地圖</h1>
          <p className="text-sm text-stone-600">點車站看出發班次，點快拍點看路面照片。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Toggle pressed={showLines} onClick={onToggleLines} label="港鐵" />
            <Toggle
              pressed={showCameras}
              onClick={onToggleCameras}
              label={cameraCount === null ? "快拍" : `快拍 ${cameraCount}`}
            />
          </div>
          <label className="mt-3 block text-sm">
            <span className="sr-only">搜尋車站</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋車站或快拍點，例如中環、H429F"
              className="w-full rounded-2xl border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-500"
              data-testid="search"
            />
          </label>
          <details className="mt-3 text-[11px] leading-snug text-stone-600">
            <summary className="flex cursor-pointer items-center gap-2">
              <img src="/landsd-logo.svg" alt="地政總署" className="h-5 w-auto shrink-0" />
              <span>Map from Lands Department · 資料來源</span>
            </summary>
            <p className="mt-1">
              車站位置是地政總署車站範圍的中心點。到站班次來自港鐵公司，快拍圖像來自運輸署，底圖為
              OpenFreeMap。圖中是十條重鐵，不含輕鐵。
              {places
                ? ` 已放上 ${places.length} / ${stations.length} 個車站。`
                : " 車站位置載入後會畫出路綫。"}
            </p>
          </details>
          {(matches.length > 0 || cameraMatches.length > 0) && (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-stone-200 bg-white">
              {matches.map((station) => (
                <li key={station.code}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-stone-50"
                    onClick={() => {
                      onPickStation(station.code)
                      setQuery("")
                    }}
                  >
                    <span>
                      <span className="font-semibold">{station.nameZh}</span>
                      <span className="ml-2 text-sm text-stone-500">{station.nameEn}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {station.lines.slice(0, 2).map((line) => (
                        <LineChip key={line} code={line} />
                      ))}
                    </span>
                  </button>
                </li>
              ))}
              {cameraMatches.map((camera) => (
                <li key={camera.key}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-stone-50"
                    onClick={() => {
                      onPickCamera(camera.key)
                      setQuery("")
                    }}
                  >
                    <span>
                      <span className="font-semibold">{camera.description}</span>
                      <span className="ml-2 text-sm text-stone-500">{camera.key}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-orange-800">快拍</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Status
          placesStatus={placesStatus}
          cameraStatus={cameraStatus}
          missingStations={missingStations}
        />
      </header>
    </>
  )
}

function Toggle({
  pressed,
  onClick,
  label,
}: {
  pressed: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-semibold ${
        pressed ? "bg-[#1b2430] text-white" : "border border-stone-300 bg-white text-stone-700"
      }`}
    >
      {label}
    </button>
  )
}

function Status({
  placesStatus,
  cameraStatus,
  missingStations,
}: {
  placesStatus: string
  cameraStatus: string
  missingStations: string[]
}) {
  if (!placesStatus && !cameraStatus && missingStations.length === 0) return null
  return (
    <div className="pointer-events-auto space-y-1" role="status">
      {placesStatus && (
        <p className="rounded-2xl bg-[#1b2430] px-3 py-2 text-sm text-white">{placesStatus}</p>
      )}
      {missingStations.length > 0 && (
        <p className="rounded-2xl bg-amber-100 px-3 py-2 text-sm text-amber-950">
          以下車站未能對上位置，不會悄悄略過：{missingStations.join("、")}
        </p>
      )}
      {cameraStatus && (
        <p className="rounded-2xl bg-[#1b2430] px-3 py-2 text-sm text-white">{cameraStatus}</p>
      )}
    </div>
  )
}

