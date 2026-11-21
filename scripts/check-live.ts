import assert from "node:assert/strict"
import { decodeCameraCsv } from "../src/lib/cameras.ts"
import { stations } from "../src/lib/network.ts"
import { matchVenues } from "../src/lib/places.ts"
import { parseSchedule } from "../src/lib/schedule.ts"

const admiralty = stations.find((station) => station.code === "ADM")
assert.equal(stations.length, 98)
assert.equal(admiralty?.lines.length, 4)

const venueResponse = await fetch(
  "https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_venue_polygon?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application%2Fjson",
  { headers: { Origin: "http://127.0.0.1:4731" } },
)
assert.equal(venueResponse.status, 200)
assert.equal(venueResponse.headers.get("access-control-allow-origin"), "http://127.0.0.1:4731")
const matched = matchVenues(await venueResponse.json())
assert.deepEqual(matched.missing, [])
assert.equal(matched.places.length, 98)
const racecourse = matched.places.find((place) => place.code === "RAC")
const foTan = matched.places.find((place) => place.code === "FOT")
const university = matched.places.find((place) => place.code === "UNI")
assert.ok(racecourse && foTan && university)
assert.ok(foTan.lat < racecourse.lat && racecourse.lat < university.lat)

const cameraResponse = await fetch(
  "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv",
)
assert.equal(cameraResponse.status, 200)
const cameras = decodeCameraCsv(await cameraResponse.arrayBuffer())
assert.equal(cameras.length, 1013)
assert.equal(new Set(cameras.map((camera) => camera.key)).size, 1013)

const scheduleResponse = await fetch(
  "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=ISL&sta=CEN&lang=TC",
)
assert.equal(scheduleResponse.status, 200)
const central = parseSchedule("ISL", "CEN", await scheduleResponse.json())
assert.equal(central.ok, true)
assert.ok(central.directions.some((direction) => direction.trains.length > 0))
assert.equal(central.directions[0]?.trains[0]?.destName.length > 0, true)

const image = cameras.find((camera) => camera.key === "H429F")
assert.ok(image)
const imageResponse = await fetch(image.url)
assert.equal(imageResponse.status, 200)
const bytes = new Uint8Array(await imageResponse.arrayBuffer())
assert.equal(bytes[0], 0xff)
assert.equal(bytes[1], 0xd8)

console.log("live checks passed", {
  stations: matched.places.length,
  cameras: cameras.length,
  centralTrains: central.directions.reduce((sum, direction) => sum + direction.trains.length, 0),
})
