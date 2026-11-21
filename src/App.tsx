import { useEffect, useMemo, useState } from "react"
import { Chrome } from "./components/Chrome.tsx"
import { DetailPanel, type LineQuery } from "./components/DetailPanel.tsx"
import { MapCanvas } from "./components/MapCanvas.tsx"
import { loadCameras, type Camera } from "./lib/cameras.ts"
import { stationByCode } from "./lib/network.ts"
import { loadPlaces, type StationPlace } from "./lib/places.ts"
import { fetchSchedule, RateLimitError } from "./lib/schedule.ts"

type Selection = { kind: "station"; code: string } | { kind: "camera"; key: string }

export default function App() {
  const [places, setPlaces] = useState<StationPlace[] | null>(null)
  const [missingStations, setMissingStations] = useState<string[]>([])
  const [placesMessage, setPlacesMessage] = useState("正在向地政總署讀取車站位置…")
  const [cameras, setCameras] = useState<Camera[] | null>(null)
  const [cameraMessage, setCameraMessage] = useState("正在讀取快拍點…")
  const [showLines, setShowLines] = useState(true)
  const [showCameras, setShowCameras] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [lineStates, setLineStates] = useState<Record<string, LineQuery>>({})
  const [retry, setRetry] = useState(0)
  const [focus, setFocus] = useState<{ lon: number; lat: number; token: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPlaces()
      .then((result) => {
        if (cancelled) return
        setPlaces(result.places)
        setMissingStations(result.missing)
        setPlacesMessage("")
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPlacesMessage(error instanceof Error ? error.message : "暫時讀不到車站位置。")
      })
    loadCameras()
      .then((result) => {
        if (cancelled) return
        setCameras(result)
        setCameraMessage("")
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setCameraMessage(
          error instanceof Error
            ? `${error.message}港鐵網絡仍可查看。`
            : "快拍點清單暫時載入不到，港鐵網絡仍可查看。",
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selection?.kind !== "station") return
    const station = stationByCode[selection.code]
    if (!station) return
    let cancelled = false

    void (async () => {
      for (const line of station.lines) {
        if (cancelled) return
        try {
          const schedule = await fetchSchedule(line, station.code)
          if (cancelled) return
          setLineStates((current) => ({ ...current, [line]: { status: "ready", schedule } }))
        } catch (error) {
          if (cancelled) return
          setLineStates((current) => ({
            ...current,
            [line]: { status: error instanceof RateLimitError ? "limited" : "error" },
          }))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selection, retry])

  const placeIndex = useMemo(
    () => new Map((places ?? []).map((place) => [place.code, place])),
    [places],
  )
  const camera = selection?.kind === "camera"
    ? (cameras?.find((item) => item.key === selection.key) ?? null)
    : null

  function loadingState(code: string): Record<string, LineQuery> {
    const station = stationByCode[code]
    const initial: Record<string, LineQuery> = {}
    for (const line of station?.lines ?? []) initial[line] = { status: "loading" }
    return initial
  }

  function chooseCamera(key: string) {
    setSelection({ kind: "camera", key })
    const found = cameras?.find((item) => item.key === key)
    if (found) setFocus({ lon: found.lon, lat: found.lat, token: Date.now() })
  }

  function chooseStation(code: string) {
    setLineStates(loadingState(code))
    setSelection({ kind: "station", code })
    const place = placeIndex.get(code)
    if (place) setFocus({ lon: place.lon, lat: place.lat, token: Date.now() })
  }

  return (
    <main className={`map-shell ${selection ? "has-panel" : ""}`}>
      <MapCanvas
        places={places}
        cameras={cameras}
        showLines={showLines}
        showCameras={showCameras}
        selectedCode={selection?.kind === "station" ? selection.code : null}
        focus={focus}
        onStation={chooseStation}
        onCamera={(key) => setSelection({ kind: "camera", key })}
      />
      <Chrome
        showLines={showLines}
        showCameras={showCameras}
        onToggleLines={() => setShowLines((value) => !value)}
        onToggleCameras={() => setShowCameras((value) => !value)}
        placesStatus={placesMessage}
        cameraStatus={cameraMessage}
        missingStations={missingStations}
        places={places}
        cameras={cameras}
        cameraCount={cameras?.length ?? null}
        onPickStation={chooseStation}
        onPickCamera={chooseCamera}
      />
      {selection && (
        <DetailPanel
          selection={selection}
          camera={camera}
          lineStates={lineStates}
          onClose={() => setSelection(null)}
          onRetry={() => {
            if (selection?.kind !== "station") return
            setLineStates(loadingState(selection.code))
            setRetry((value) => value + 1)
          }}
        />
      )}
    </main>
  )
}
