import { stationName } from "./network.ts"

export type TrainInfo = {
  destCode: string
  destName: string
  platform: string
  minutes: number | null
  time: string
}

export type Schedule = {
  ok: boolean
  alert: string | null
  delayed: boolean
  specialUrl: string | null
  dataTime: string | null
  directions: Array<{ id: "UP" | "DOWN"; trains: TrainInfo[] }>
}

export class RateLimitError extends Error {
  constructor() {
    super("查詢太頻密，請稍後再試。")
    this.name = "RateLimitError"
  }
}

const CACHE_MS = 10_000
const cache = new Map<string, { at: number; schedule: Schedule }>()
let queue: Promise<void> = Promise.resolve()

export function fetchSchedule(line: string, station: string): Promise<Schedule> {
  const key = `${line}|${station}`
  const cached = fresh(key)
  if (cached) return Promise.resolve(cached)

  const run = queue.then(async () => {
    const again = fresh(key)
    if (again) return again
    try {
      const schedule = await requestSchedule(line, station)
      cache.set(key, { at: Date.now(), schedule })
      return schedule
    } finally {
      await sleep(400)
    }
  })
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function requestSchedule(line: string, station: string): Promise<Schedule> {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`
  const response = await fetchScheduleResponse(url)
  if (response.status === 429) throw new RateLimitError()
  if (!response.ok) throw new Error("暫時連不到港鐵到站資料，請再試一次。")
  return parseSchedule(line, station, await response.json())
}

async function fetchScheduleResponse(url: string): Promise<Response> {
  try {
    const response = await fetch(url)
    if (response.status !== 429) return response
  } catch {
    // A rate-limit response sometimes has no CORS header, so the browser
    // reports a network error instead of HTTP 429.
  }
  await sleep(1200)
  return fetch(url)
}

type RawTrain = {
  seq?: string
  dest?: string
  plat?: string
  time?: string
  ttnt?: string
  valid?: string
}

type RawPayload = {
  status?: number
  message?: string
  isdelay?: string
  url?: string
  curr_time?: string
  sys_time?: string
  data?: Record<string, { UP?: RawTrain[]; DOWN?: RawTrain[] }>
}

export function parseSchedule(line: string, station: string, payload: unknown): Schedule {
  const data = (payload ?? {}) as RawPayload
  const message = String(data.message ?? "").trim()
  const successful = message.toLowerCase() === "successful"
  const empty = message.toLowerCase().includes("contents are empty")
  const alert = successful ? null : empty ? "暫時沒有這站的到站資料。" : message || null
  if (data.status !== 1) {
    return {
      ok: false,
      alert: alert ?? "暫時沒有這站的到站資料。",
      delayed: false,
      specialUrl: httpUrl(data.url),
      dataTime: null,
      directions: [],
    }
  }

  const entry = data.data?.[`${line}-${station}`] ?? Object.values(data.data ?? {})[0]
  return {
    ok: true,
    alert,
    delayed: String(data.isdelay ?? "").toUpperCase() === "Y",
    specialUrl: httpUrl(data.url),
    dataTime: data.curr_time || data.sys_time || null,
    directions: [
      { id: "UP", trains: trainsOf(entry?.UP) },
      { id: "DOWN", trains: trainsOf(entry?.DOWN) },
    ],
  }
}

function trainsOf(trains: RawTrain[] | undefined): TrainInfo[] {
  return (trains ?? [])
    .filter((train) => train.valid !== "N")
    .slice()
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
    .map((train) => {
      const minutes = Number(train.ttnt)
      const destCode = train.dest ?? ""
      return {
        destCode,
        destName: stationName(destCode),
        platform: train.plat?.trim() ?? "",
        minutes: Number.isFinite(minutes) ? minutes : null,
        time: clock(train.time),
      }
    })
}

function clock(value: string | undefined): string {
  const match = value?.match(/(\d{2}:\d{2})/)
  return match?.[1] ?? ""
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString()
  } catch {
    return null
  }
  return null
}

function fresh(key: string): Schedule | null {
  const hit = cache.get(key)
  if (!hit || Date.now() - hit.at > CACHE_MS) return null
  return hit.schedule
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
