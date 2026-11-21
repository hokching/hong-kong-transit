export type Camera = {
  key: string
  region: string
  district: string
  description: string
  lon: number
  lat: number
  url: string
}

const CAMERA_URL =
  "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv"

export async function loadCameras(): Promise<Camera[]> {
  const response = await fetch(CAMERA_URL)
  if (!response.ok) throw new Error("暫時讀不到交通快拍點清單。")
  const cameras = decodeCameraCsv(await response.arrayBuffer())
  if (cameras.length === 0) throw new Error("交通快拍點清單是空的。")
  return cameras
}

export function decodeCameraCsv(buffer: ArrayBuffer): Camera[] {
  const bytes = new Uint8Array(buffer)
  const utf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  const text = new TextDecoder(utf16 ? "utf-16" : "utf-8")
    .decode(buffer)
    .replace(/^\uFEFF+/, "")
  const rows = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  const header = rows[0]?.split("\t").map((cell) => cell.trim()) ?? []
  const index = Object.fromEntries(header.map((name, position) => [name, position]))
  const cameras: Camera[] = []
  for (const row of rows.slice(1)) {
    const cells = row.split("\t")
    const key = cell(cells, index.key)
    const url = cell(cells, index.url)
    const latitude = cell(cells, index.latitude)
    const longitude = cell(cells, index.longitude)
    const lat = Number(latitude)
    const lon = Number(longitude)
    if (!key || !url || latitude === "" || longitude === "") continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    cameras.push({
      key,
      region: cell(cells, index.region),
      district: cell(cells, index.district),
      description: cell(cells, index.description) || key,
      lon,
      lat,
      url,
    })
  }
  return cameras
}

function cell(cells: string[], index: number | undefined): string {
  if (index === undefined) return ""
  return cells[index]?.trim() ?? ""
}
