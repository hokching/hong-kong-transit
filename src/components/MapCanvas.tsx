import { useEffect, useRef, useState } from "react"
import {
  Map as MlMap,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapGeoJSONFeature,
} from "maplibre-gl"
import { lineByCode, lines, stationByCode } from "../lib/network.ts"
import type { Camera } from "../lib/cameras.ts"
import type { StationPlace } from "../lib/places.ts"

const STYLE = "https://tiles.openfreemap.org/styles/liberty"

type Props = {
  places: StationPlace[] | null
  cameras: Camera[] | null
  showLines: boolean
  showCameras: boolean
  selectedCode: string | null
  focus: { lon: number; lat: number; token: number } | null
  onStation: (code: string) => void
  onCamera: (key: string) => void
}

export function MapCanvas({
  places,
  cameras,
  showLines,
  showCameras,
  selectedCode,
  focus,
  onStation,
  onCamera,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const placesRef = useRef(places)
  const camerasRef = useRef(cameras)
  const onStationRef = useRef(onStation)
  const onCameraRef = useRef(onCamera)
  const cameraByKey = useRef(new Map<string, Camera>())

  useEffect(() => {
    placesRef.current = places
    camerasRef.current = cameras
    onStationRef.current = onStation
    onCameraRef.current = onCamera
    cameraByKey.current = new Map((cameras ?? []).map((camera) => [camera.key, camera]))
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new MlMap({
      container,
      style: STYLE,
      center: [114.17, 22.36],
      zoom: 10.35,
      maxBounds: [
        [113.7, 22.05],
        [114.55, 22.65],
      ],
      attributionControl: { compact: false },
    })
    mapRef.current = map

    map.on("load", () => {
      map.resize()
      map.addSource("mtr-lines", { type: "geojson", data: emptyCollection() })
      map.addSource("stations", { type: "geojson", data: emptyCollection() })
      map.addSource("cameras", {
        type: "geojson",
        data: emptyCollection(),
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 13,
      })

      map.addLayer({
        id: "mtr-lines",
        type: "line",
        source: "mtr-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 14, 5],
          "line-opacity": 0.92,
        },
      })
      map.addLayer({
        id: "camera-clusters",
        type: "circle",
        source: "cameras",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#9a3412",
          "circle-radius": ["step", ["get", "point_count"], 15, 30, 19, 80, 24],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
      })
      map.addLayer({
        id: "camera-count",
        type: "symbol",
        source: "cameras",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#fff7ed" },
      })
      map.addLayer({
        id: "camera-points",
        type: "circle",
        source: "cameras",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#c2410c",
          "circle-radius": 5,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff7ed",
        },
      })
      map.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["case", [">", ["get", "lineCount"], 1], 6.5, 5],
          "circle-stroke-width": ["case", [">", ["get", "lineCount"], 1], 2.5, 1.5],
          "circle-stroke-color": "#ffffff",
        },
      })
      map.addLayer({
        id: "station-labels",
        type: "symbol",
        source: "stations",
        minzoom: 12,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 1.05],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#1b2430",
          "text-halo-color": "#f7f4ee",
          "text-halo-width": 1.4,
        },
      })

      paintNetwork(map, placesRef.current)
      paintCameras(map, camerasRef.current)
      setReady(true)

      map.on("click", (event) => {
        const stationHit = map.queryRenderedFeatures(event.point, { layers: ["stations"] })[0]
        const stationCode = stringProperty(stationHit, "code")
        if (stationCode) {
          onStationRef.current(stationCode)
          easeTo(map, pointCoordinates(stationHit))
          return
        }
        const cameraHit = map.queryRenderedFeatures(event.point, { layers: ["camera-points"] })[0]
        const cameraKey = stringProperty(cameraHit, "key")
        if (cameraKey && cameraByKey.current.has(cameraKey)) {
          onCameraRef.current(cameraKey)
          easeTo(map, pointCoordinates(cameraHit))
          return
        }
        const cluster = map.queryRenderedFeatures(event.point, { layers: ["camera-clusters"] })[0]
        const clusterId = cluster?.properties?.cluster_id
        if (typeof clusterId === "number") {
          const center = pointCoordinates(cluster)
          const source = map.getSource("cameras") as GeoJSONSource
          if (!center) return
          void source.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center, zoom })
          })
        }
      })

      map.on("mousemove", (event) => {
        const hits = map.queryRenderedFeatures(event.point, {
          layers: ["stations", "camera-points", "camera-clusters"],
        })
        map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : ""
      })
    })

    return () => {
      setReady(false)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    paintNetwork(map, places)
  }, [places, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    paintCameras(map, cameras)
  }, [cameras, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer("stations")) return
    const selected = selectedCode ?? ""
    map.setPaintProperty("stations", "circle-radius", [
      "case",
      ["==", ["get", "code"], selected],
      9,
      [">", ["get", "lineCount"], 1],
      6.5,
      5,
    ])
    map.setPaintProperty("stations", "circle-stroke-color", [
      "case",
      ["==", ["get", "code"], selected],
      "#111827",
      "#ffffff",
    ])
  }, [selectedCode, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const show = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none")
    }
    for (const id of ["mtr-lines", "stations", "station-labels"]) show(id, showLines)
    for (const id of ["camera-clusters", "camera-count", "camera-points"]) show(id, showCameras)
  }, [showLines, showCameras, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus) return
    easeTo(map, [focus.lon, focus.lat])
  }, [focus, ready])

  return <div ref={containerRef} className="absolute inset-0" data-testid="map" />
}

function paintNetwork(map: MapLibreMap, places: StationPlace[] | null) {
  const linesSource = map.getSource("mtr-lines") as GeoJSONSource | undefined
  const stationSource = map.getSource("stations") as GeoJSONSource | undefined
  if (!linesSource || !stationSource) return
  const index = new Map((places ?? []).map((place) => [place.code, place]))
  linesSource.setData({
    type: "FeatureCollection",
    features: lines.flatMap((line) =>
      line.paths.flatMap((path) => lineSegments(path, index, line.color)),
    ),
  })
  stationSource.setData({
    type: "FeatureCollection",
    features: (places ?? []).flatMap((place) => {
      const station = stationByCode[place.code]
      if (!station) return []
      return [
        {
          type: "Feature" as const,
          properties: {
            code: station.code,
            name: station.nameZh,
            color: lineByCode[station.lines[0]]?.color ?? "#334155",
            lineCount: station.lines.length,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [place.lon, place.lat] as [number, number],
          },
        },
      ]
    }),
  })
}

function lineSegments(path: string[], index: Map<string, StationPlace>, color: string) {
  const features: Array<{
    type: "Feature"
    properties: { color: string }
    geometry: { type: "LineString"; coordinates: Array<[number, number]> }
  }> = []
  let run: Array<[number, number]> = []
  const flush = () => {
    if (run.length >= 2) {
      features.push({
        type: "Feature",
        properties: { color },
        geometry: { type: "LineString", coordinates: run },
      })
    }
    run = []
  }
  for (const code of path) {
    const place = index.get(code)
    if (!place) {
      flush()
      continue
    }
    run.push([place.lon, place.lat])
  }
  flush()
  return features
}

function paintCameras(map: MapLibreMap, cameras: Camera[] | null) {
  const source = map.getSource("cameras") as GeoJSONSource | undefined
  if (!source) return
  source.setData({
    type: "FeatureCollection",
    features: (cameras ?? []).map((camera) => ({
      type: "Feature" as const,
      properties: { key: camera.key },
      geometry: {
        type: "Point" as const,
        coordinates: [camera.lon, camera.lat] as [number, number],
      },
    })),
  })
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] }
}

function stringProperty(feature: MapGeoJSONFeature | undefined, key: string): string {
  const value = feature?.properties?.[key]
  return typeof value === "string" ? value : ""
}

function pointCoordinates(feature: MapGeoJSONFeature | undefined): [number, number] | null {
  if (feature?.geometry.type !== "Point") return null
  const [lon, lat] = feature.geometry.coordinates
  if (typeof lon !== "number" || typeof lat !== "number") return null
  return [lon, lat]
}

function easeTo(map: MapLibreMap, center: [number, number] | null) {
  if (!center) return
  const mobile = window.matchMedia("(max-width: 767px)").matches
  const zoom = map.getZoom()
  map.easeTo({
    center,
    zoom: zoom < 12 ? 12.6 : zoom,
    offset: mobile ? [0, -80] : [0, 0],
    duration: 450,
  })
}
