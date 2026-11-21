import { useEffect, useMemo, useRef, useState } from "react"
import type { StationPlace } from "./places.ts"
import { fetchSchedule, hongKongMillis, RateLimitError } from "./schedule.ts"
import {
  buildRoutes,
  composeTrains,
  sampleStops,
  type MovingTrain,
  type Observation,
  type TrainMode,
} from "./trainMotion.ts"

export type LiveTrain = MovingTrain & { id: string }

const STATUS: Record<TrainMode, string> = {
  loading: "正在接收到站時間。未接到之前，列車先沿路綫模擬行走。",
  live: "列車位置按到站倒數估計，不是車載定位。",
  partial: "部分路綫按到站倒數估計，其餘仍在模擬。",
  simulated: "暫時收不到到站時間，列車位置是模擬。",
  closed: "非行車時間，沒有列車。",
}

export function useTrains(places: StationPlace[] | null, enabled: boolean) {
  const routes = useMemo(() => (places ? buildRoutes(places) : []), [places])
  const [trains, setTrains] = useState<LiveTrain[]>([])
  const [status, setStatus] = useState(STATUS.loading)
  const observations = useRef<Observation[]>([])
  const liveLines = useRef(new Set<string>())
  const heard = useRef(false)
  const previous = useRef<LiveTrain[]>([])

  useEffect(() => {
    if (!enabled || routes.length === 0) return
    let stopped = false
    const stops = sampleStops(routes)
    let cursor = 0

    const poll = async () => {
      while (!stopped) {
        if (document.hidden) {
          await sleep(2000)
          continue
        }
        const stop = stops[cursor % stops.length]
        cursor += 1
        try {
          const schedule = await fetchSchedule(stop.line, stop.station, "background")
          if (stopped) return
          heard.current = true
          const now = Date.now()
          const fresh = observationsFrom(stop.line, stop.station, schedule, now)
          if (fresh.length > 0) liveLines.current.add(stop.line)
          observations.current = [
            ...observations.current.filter(
              (item) =>
                !(item.line === stop.line && item.station === stop.station) && now - item.seenAt < 3 * 60 * 1000,
            ),
            ...fresh,
          ]
        } catch (error) {
          heard.current = true
          if (error instanceof RateLimitError) await sleep(20_000)
        }
      }
    }
    void poll()
    return () => {
      stopped = true
    }
  }, [enabled, routes])

  useEffect(() => {
    if (!enabled || routes.length === 0) {
      previous.current = []
      return
    }
    const tick = () => {
      const now = Date.now()
      for (const line of [...liveLines.current]) {
        const latest = observations.current.some((item) => item.line === line && now - item.seenAt < 3 * 60 * 1000)
        if (!latest) liveLines.current.delete(line)
      }
      const composed = composeTrains(routes, observations.current, liveLines.current, heard.current, now)
      const next = assignIds(previous.current, composed.trains)
      previous.current = next
      setTrains(next)
      setStatus(STATUS[composed.mode])
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [enabled, routes])

  return { trains: enabled ? trains : [], status: enabled ? status : "" }
}

function observationsFrom(
  line: string,
  station: string,
  schedule: Awaited<ReturnType<typeof fetchSchedule>>,
  now: number,
): Observation[] {
  if (!schedule.ok) return []
  const observations: Observation[] = []
  for (const direction of schedule.directions) {
    for (const train of direction.trains) {
      const arrivalMs = train.arrivalAt
        ? hongKongMillis(train.arrivalAt)
        : train.minutes === null
          ? null
          : now + train.minutes * 60_000
      if (arrivalMs === null || !train.destCode) continue
      observations.push({ line, station, dest: train.destCode, arrivalMs, seenAt: now })
    }
  }
  return observations
}

function assignIds(previous: LiveTrain[], trains: MovingTrain[]): LiveTrain[] {
  const used = new Set<string>()
  return trains.map((train) => {
    let match: LiveTrain | null = null
    let best = 1600
    for (const earlier of previous) {
      if (used.has(earlier.id) || earlier.line !== train.line || earlier.dest !== train.dest) continue
      if (earlier.simulated !== train.simulated) continue
      const distance = Math.hypot((earlier.lon - train.lon) * 100_000, (earlier.lat - train.lat) * 100_000)
      if (distance < best) {
        best = distance
        match = earlier
      }
    }
    const id = match?.id ?? `${train.line}-${train.dest}-${Math.random().toString(36).slice(2, 8)}`
    used.add(id)
    return { ...train, id }
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
