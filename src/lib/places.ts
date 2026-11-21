import { stations } from "./network.ts"

export type StationPlace = {
  code: string
  lon: number
  lat: number
}

export type VenueCollection = {
  features?: Array<{
    properties?: {
      venue_name_zh?: string
      bbox?: number[]
    }
    geometry?: {
      type?: string
      coordinates?: unknown
    }
  }>
}

const VENUE_URL =
  "https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_venue_polygon?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application%2Fjson"

const CACHE_KEY = "hk-mtr-centers-v1"

export function matchVenues(
  collection: VenueCollection,
): { places: StationPlace[]; missing: string[] } {
  const centers = new Map<string, StationPlace>()
  for (const feature of collection.features ?? []) {
    const name = feature.properties?.venue_name_zh
    const center = featureCenter(feature)
    if (!name || !center) continue
    centers.set(name, { code: "", lon: center[0], lat: center[1] })
  }

  const places: StationPlace[] = []
  const missing: string[] = []
  for (const station of stations) {
    const venueName = `${station.nameZh.replaceAll("茘", "荔")}鐵路站`
    const center = centers.get(venueName)
    if (!center) {
      missing.push(station.nameZh)
      continue
    }
    places.push({ code: station.code, lon: center.lon, lat: center.lat })
  }
  return { places, missing }
}

export async function loadPlaces(): Promise<{
  places: StationPlace[]
  missing: string[]
}> {
  const cached = readCache()
  if (cached) return { places: cached, missing: [] }

  const response = await fetch(VENUE_URL)
  if (!response.ok) {
    throw new Error("暫時連不到地政總署的車站位置。")
  }
  const collection = (await response.json()) as VenueCollection
  const matched = matchVenues(collection)
  if (matched.missing.length === 0) writeCache(matched.places)
  return matched
}

function featureCenter(feature: NonNullable<VenueCollection["features"]>[number]): [number, number] | null {
  const bbox = feature.properties?.bbox
  if (bbox && bbox.length === 4 && bbox.every((value) => Number.isFinite(value))) {
    return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  }
  const points: Array<[number, number]> = []
  collectPositions(feature.geometry?.coordinates, points)
  if (points.length === 0) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
}

function collectPositions(value: unknown, points: Array<[number, number]>) {
  if (!Array.isArray(value)) return
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    points.push([value[0], value[1]])
    return
  }
  for (const child of value) collectPositions(child, points)
}

function signature(): string {
  return stations
    .map((station) => station.code)
    .slice()
    .sort()
    .join(",")
}

function readCache(): StationPlace[] | null {
  try {
    if (typeof sessionStorage === "undefined") return null
    const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "") as {
      signature?: string
      places?: StationPlace[]
    }
    if (parsed.signature !== signature() || !Array.isArray(parsed.places)) return null
    if (parsed.places.length !== stations.length) return null
    return parsed.places
  } catch {
    return null
  }
}

function writeCache(places: StationPlace[]) {
  try {
    if (typeof sessionStorage === "undefined") return
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ signature: signature(), places }))
  } catch {
    // A blocked or full cache must not stop the live coordinate request.
  }
}
