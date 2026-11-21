import { trackPaths } from "../data/mtr-tracks.ts"
import { lineByCode, lines, stationName } from "./network.ts"
import type { StationPlace } from "./places.ts"

export const RUN_MPS = 13.5
export const DWELL_S = 24
const SIM_MPS = 12
const MERGE_METERS = 700

const HEADWAY_S: Record<string, number> = {
  ISL: 140,
  TWL: 140,
  KTL: 150,
  TKL: 170,
  EAL: 210,
  TML: 190,
  TCL: 300,
  AEL: 480,
  SIL: 240,
  DRL: 540,
}

type TrackPoint = [number, number]
type Vertex = { chainage: number; point: TrackPoint }

export type LineRoute = {
  line: string
  pathIndex: number
  stations: string[]
  chainages: number[]
  vertices: Vertex[]
  length: number
}

export type Observation = {
  line: string
  station: string
  dest: string
  arrivalMs: number
  seenAt: number
}

export type MovingTrain = {
  line: string
  color: string
  dest: string
  destName: string
  nextCode: string
  nextName: string
  minutes: number
  lon: number
  lat: number
  bearing: number
  simulated: boolean
}

export type TrainMode = "loading" | "live" | "partial" | "simulated" | "closed"

export function buildRoutes(places: StationPlace[]): LineRoute[] {
  const byCode = new Map(places.map((place) => [place.code, place]))
  const routes: LineRoute[] = []
  for (const line of lines) {
    const geometries = trackPaths[line.code] ?? []
    line.paths.forEach((stations, pathIndex) => {
      const vertices = verticesOf(geometries[pathIndex] ?? [])
      if (vertices.length < 2) return
      const chainages: number[] = []
      for (const code of stations) {
        const place = byCode.get(code)
        if (!place) return
        chainages.push(projectOnto([place.lon, place.lat], vertices).chainage)
      }
      for (let index = 1; index < chainages.length; index += 1) {
        if (chainages[index] <= chainages[index - 1]) chainages[index] = chainages[index - 1] + 30
      }
      routes.push({
        line: line.code,
        pathIndex,
        stations,
        chainages,
        vertices,
        length: vertices[vertices.length - 1].chainage,
      })
    })
  }
  return routes
}

export function sampleStops(routes: LineRoute[]): Array<{ line: string; station: string }> {
  const byLine = new Map<string, LineRoute[]>()
  for (const route of routes) {
    const list = byLine.get(route.line) ?? []
    list.push(route)
    byLine.set(route.line, list)
  }
  const groups: Array<Array<{ line: string; station: string }>> = []
  for (const [line, list] of byLine) {
    const main = [...list].sort((a, b) => scoreRoute(b) - scoreRoute(a))[0]
    const ordered = [...main.stations]
    for (const route of list) {
      for (const code of route.stations) {
        if (!ordered.includes(code)) ordered.push(code)
      }
    }
    const stride = ordered.length <= 5 ? 1 : Math.ceil(ordered.length / 6)
    const picks: Array<{ line: string; station: string }> = []
    const seen = new Set<string>()
    for (let index = 0; index < ordered.length; index += stride) addStop(picks, seen, line, ordered[index])
    addStop(picks, seen, line, ordered[ordered.length - 1])
    groups.push(picks)
  }
  const interleaved: Array<{ line: string; station: string }> = []
  const longest = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      if (group[index]) interleaved.push(group[index])
    }
  }
  return interleaved
}

export function composeTrains(
  routes: LineRoute[],
  observations: Observation[],
  liveLines: ReadonlySet<string>,
  heard: boolean,
  now: number,
): { trains: MovingTrain[]; mode: TrainMode } {
  const open = serviceOpen(now)
  const estimated = cluster(estimate(routes, observations, now))
  const live = new Set(liveLines)
  for (const train of estimated) live.add(train.line)
  const simulated = open ? simulate(routes, now).filter((train) => !live.has(train.line)) : []
  const trains = [...estimated.filter((train) => live.has(train.line)), ...simulated]
  if (!open && estimated.length === 0) return { trains: [], mode: "closed" }
  if (live.size === 0) return { trains, mode: heard ? "simulated" : "loading" }
  if (simulated.length > 0) return { trains, mode: "partial" }
  return { trains, mode: "live" }
}

export function serviceOpen(now: number): boolean {
  const hongKong = new Date(now + 8 * 60 * 60 * 1000)
  const minutes = hongKong.getUTCHours() * 60 + hongKong.getUTCMinutes()
  return minutes >= 5 * 60 + 20 || minutes < 1 * 60 + 15
}

function estimate(routes: LineRoute[], observations: Observation[], now: number): MovingTrain[] {
  const trains: MovingTrain[] = []
  for (const observation of observations) {
    if (now - observation.seenAt > 3 * 60 * 1000) continue
    const remaining = (observation.arrivalMs - now) / 1000
    if (remaining > 14 * 60 || remaining < -45) continue
    const route = chooseRoute(routes, observation.line, observation.station, observation.dest)
    if (!route) continue
    const stationIndex = route.stations.indexOf(observation.station)
    const destIndex = route.stations.indexOf(observation.dest)
    const located = locate(route, stationIndex, destIndex, remaining)
    if (!located) continue
    const spot = pointAt(route, located.chainage, located.step)
    trains.push(trainFrom(route, observation.dest, located.nextIndex, located.secondsToNext, spot, false))
  }
  return trains
}

function simulate(routes: LineRoute[], now: number): MovingTrain[] {
  const trains: MovingTrain[] = []
  const occupied: MovingTrain[] = []
  for (const route of routes) {
    if (route.stations.includes("RAC")) continue
    const headway = HEADWAY_S[route.line] ?? 180
    const spacing = Math.min(Math.max(900, headway * SIM_MPS), Math.max(700, route.length / 2))
    const offset = ((now / 1000) * SIM_MPS) % spacing
    for (const step of [1, -1]) {
      for (let chainage = step === 1 ? offset : route.length - offset; chainage > 80 && chainage < route.length - 80; chainage += step * spacing) {
        const spot = pointAt(route, chainage, step)
        const nextIndex = nextStationIndex(route, chainage, step)
        const distance = Math.abs(route.chainages[nextIndex] - chainage)
        const draft = trainFrom(route, step > 0 ? route.stations.at(-1)! : route.stations[0], nextIndex, distance / SIM_MPS, spot, true)
        if (occupied.some((train) => train.line === draft.line && distanceMeters(train, draft) < 350)) continue
        occupied.push(draft)
        trains.push(draft)
      }
    }
  }
  return trains
}

function trainFrom(
  route: LineRoute,
  dest: string,
  nextIndex: number,
  secondsToNext: number,
  spot: { lon: number; lat: number; bearing: number },
  simulated: boolean,
): MovingTrain {
  const nextCode = route.stations[Math.min(route.stations.length - 1, Math.max(0, nextIndex))]
  return {
    line: route.line,
    color: lineByCode[route.line]?.color ?? "#334155",
    dest,
    destName: stationName(dest),
    nextCode,
    nextName: stationName(nextCode),
    minutes: Math.max(0, Math.round(secondsToNext / 60)),
    lon: spot.lon,
    lat: spot.lat,
    bearing: spot.bearing,
    simulated,
  }
}

function locate(
  route: LineRoute,
  stationIndex: number,
  destIndex: number,
  remaining: number,
): { chainage: number; step: number; nextIndex: number; secondsToNext: number } | null {
  if (stationIndex < 0 || destIndex < 0) return null
  const step = destIndex > stationIndex ? 1 : destIndex < stationIndex ? -1 : stationIndex === 0 ? -1 : 1
  let cursor = stationIndex
  let seconds = remaining
  if (seconds < 0) {
    const since = -seconds
    if (since <= DWELL_S) return atStation(route, cursor, step, 0)
    const ahead = cursor + step
    if (!inside(route, ahead)) return atStation(route, cursor, step, 0)
    const travel = travelSeconds(route, cursor, ahead)
    const moving = since - DWELL_S
    if (moving >= travel) return atStation(route, ahead, step, 0)
    return {
      chainage: lerp(route.chainages[cursor], route.chainages[ahead], moving / travel),
      step,
      nextIndex: ahead,
      secondsToNext: travel - moving,
    }
  }
  for (let guard = 0; guard < route.stations.length; guard += 1) {
    const behind = cursor - step
    if (!inside(route, behind)) return atStation(route, cursor, step, seconds)
    const travel = travelSeconds(route, behind, cursor)
    if (seconds <= travel) {
      const fraction = 1 - seconds / travel
      return {
        chainage: lerp(route.chainages[behind], route.chainages[cursor], fraction),
        step,
        nextIndex: cursor,
        secondsToNext: seconds,
      }
    }
    seconds -= travel
    if (seconds <= DWELL_S) return atStation(route, behind, step, DWELL_S - seconds)
    seconds -= DWELL_S
    cursor = behind
  }
  return atStation(route, cursor, step, 0)
}

function atStation(route: LineRoute, index: number, step: number, dwellLeft: number) {
  const ahead = index + step
  const nextIndex = inside(route, ahead) ? ahead : index
  const secondsToNext = inside(route, ahead) ? dwellLeft + travelSeconds(route, index, ahead) : dwellLeft
  return { chainage: route.chainages[index], step, nextIndex, secondsToNext }
}

function travelSeconds(route: LineRoute, from: number, to: number): number {
  return Math.max(25, Math.abs(route.chainages[to] - route.chainages[from]) / runSpeed(route.line))
}

function runSpeed(line: string): number {
  if (line === "AEL") return 24
  if (line === "TCL") return 17
  return RUN_MPS
}

function nextStationIndex(route: LineRoute, chainage: number, step: number): number {
  if (step > 0) {
    const found = route.chainages.findIndex((value) => value > chainage + 20)
    return found === -1 ? route.stations.length - 1 : found
  }
  for (let index = route.chainages.length - 1; index >= 0; index -= 1) {
    if (route.chainages[index] < chainage - 20) return index
  }
  return 0
}

function chooseRoute(routes: LineRoute[], line: string, station: string, dest: string): LineRoute | null {
  const candidates = routes.filter(
    (route) => route.line === line && route.stations.includes(station) && route.stations.includes(dest),
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => rankRoute(a, station, dest) - rankRoute(b, station, dest))
  return candidates[0]
}

function rankRoute(route: LineRoute, station: string, dest: string): number {
  const race = route.stations.includes("RAC") ? 1 : 0
  const span = Math.abs(route.stations.indexOf(dest) - route.stations.indexOf(station))
  return (dest === "RAC" ? -race : race) * 100 + span
}

function scoreRoute(route: LineRoute): number {
  return route.stations.length - (route.stations.includes("RAC") ? 100 : 0)
}

function cluster(trains: MovingTrain[]): MovingTrain[] {
  const kept: MovingTrain[] = []
  for (const train of trains) {
    const clash = kept.find(
      (item) => item.line === train.line && item.dest === train.dest && distanceMeters(item, train) < MERGE_METERS,
    )
    if (!clash) kept.push(train)
    else if (train.minutes < clash.minutes) kept[kept.indexOf(clash)] = train
  }
  return kept
}

function pointAt(route: LineRoute, chainage: number, step: number): { lon: number; lat: number; bearing: number } {
  const clamped = Math.min(route.length, Math.max(0, chainage))
  let index = 1
  while (index < route.vertices.length - 1 && route.vertices[index].chainage < clamped) index += 1
  const end = route.vertices[index]
  const start = route.vertices[index - 1]
  const span = Math.max(1, end.chainage - start.chainage)
  const fraction = (clamped - start.chainage) / span
  const lon = start.point[0] + (end.point[0] - start.point[0]) * fraction
  const lat = start.point[1] + (end.point[1] - start.point[1]) * fraction
  const forward = pointNear(route, clamped + step * 40)
  const backward = pointNear(route, clamped - step * 40)
  return { lon, lat, bearing: bearing(backward, forward) }
}

function pointNear(route: LineRoute, chainage: number): TrackPoint {
  const clamped = Math.min(route.length, Math.max(0, chainage))
  let index = 1
  while (index < route.vertices.length - 1 && route.vertices[index].chainage < clamped) index += 1
  const end = route.vertices[index]
  const start = route.vertices[index - 1]
  const span = Math.max(1, end.chainage - start.chainage)
  const fraction = (clamped - start.chainage) / span
  return [start.point[0] + (end.point[0] - start.point[0]) * fraction, start.point[1] + (end.point[1] - start.point[1]) * fraction]
}

function verticesOf(parts: TrackPoint[][]): Vertex[] {
  const vertices: Vertex[] = []
  let chainage = 0
  let previous: TrackPoint | null = null
  for (const part of parts) {
    for (const point of part) {
      if (previous) chainage += distanceMeters(previous, point)
      vertices.push({ chainage, point })
      previous = point
    }
  }
  return vertices
}

function projectOnto(point: TrackPoint, vertices: Vertex[]): { chainage: number } {
  let bestChainage = 0
  let bestDistance = Infinity
  for (let index = 1; index < vertices.length; index += 1) {
    const start = vertices[index - 1]
    const end = vertices[index]
    const projected = projectSegment(point, start.point, end.point)
    const distance = distanceMeters(point, projected.point)
    if (distance < bestDistance) {
      bestDistance = distance
      bestChainage = start.chainage + projected.ratio * (end.chainage - start.chainage)
    }
  }
  return { chainage: bestChainage }
}

function projectSegment(
  point: TrackPoint,
  start: TrackPoint,
  end: TrackPoint,
): { ratio: number; point: TrackPoint } {
  const origin = (start[1] + end[1]) / 2
  const a = toMeters(start, origin)
  const b = toMeters(end, origin)
  const p = toMeters(point, origin)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const ratio = length === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
  return { ratio, point: [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio] }
}

function bearing(from: TrackPoint, to: TrackPoint): number {
  const lat = (((from[1] + to[1]) / 2) * Math.PI) / 180
  const dx = (to[0] - from[0]) * Math.cos(lat)
  const dy = to[1] - from[1]
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

function distanceMeters(a: { lon?: number; lat?: number } | TrackPoint, b: { lon?: number; lat?: number } | TrackPoint): number {
  const first = asPoint(a)
  const second = asPoint(b)
  const lat = (((first[1] + second[1]) / 2) * Math.PI) / 180
  const dx = (second[0] - first[0]) * 111_320 * Math.cos(lat)
  const dy = (second[1] - first[1]) * 110_540
  return Math.hypot(dx, dy)
}

function toMeters(point: TrackPoint, originLat: number): [number, number] {
  const lat = (originLat * Math.PI) / 180
  return [point[0] * 111_320 * Math.cos(lat), point[1] * 110_540]
}

function asPoint(value: { lon?: number; lat?: number } | TrackPoint): TrackPoint {
  if (Array.isArray(value)) return value
  return [value.lon ?? 0, value.lat ?? 0]
}

function lerp(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction
}

function inside(route: LineRoute, index: number): boolean {
  return index >= 0 && index < route.stations.length
}

function addStop(
  picks: Array<{ line: string; station: string }>,
  seen: Set<string>,
  line: string,
  station: string,
) {
  const key = `${line}|${station}`
  if (seen.has(key)) return
  seen.add(key)
  picks.push({ line, station })
}
