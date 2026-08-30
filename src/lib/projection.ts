/**
 * The projection cobe's shaders use, reimplemented in TypeScript.
 *
 * cobe renders the globe on the GPU and offers no picking, so to make station
 * signals clickable we place points on screen exactly the way its vertex shader
 * does. Every constant here is read from cobe 2.0.1:
 *
 *   - a marker at [lat, lon] sits on the unit sphere at
 *       p = [-cos(lat)cos(lon-PI), sin(lat), cos(lat)sin(lon-PI)]
 *   - the sphere is drawn at radius 0.8 in clip space
 *   - the camera rotation is R = Rx(theta) . Ry(phi)
 *   - clip x is squashed by height/width, so both axes scale with the height
 */

export const SPHERE_RADIUS = 0.8

export interface View {
  /** Rotation about the polar axis, radians. */
  phi: number
  /** Tilt towards the viewer, radians. */
  theta: number
  /** cobe's `scale` option. */
  scale: number
  /** CSS pixels. */
  width: number
  height: number
}

export interface Screen {
  x: number
  y: number
  /** Depth along the view axis; negative means the far side of the globe. */
  z: number
  visible: boolean
}

/** Unit-sphere position of a geographic coordinate, in cobe's frame. */
export function toSphere(lat: number, lon: number): [number, number, number] {
  const phi = (lat * Math.PI) / 180
  const lambda = (lon * Math.PI) / 180 - Math.PI
  const cosPhi = Math.cos(phi)
  return [-cosPhi * Math.cos(lambda), Math.sin(phi), cosPhi * Math.sin(lambda)]
}

/** Where a geographic coordinate lands on the canvas, in CSS pixels. */
export function project(lat: number, lon: number, view: View): Screen {
  const [px, py, pz] = toSphere(lat, lon)
  const cosPhi = Math.cos(view.phi)
  const sinPhi = Math.sin(view.phi)
  const cosTheta = Math.cos(view.theta)
  const sinTheta = Math.sin(view.theta)

  const ax = px * SPHERE_RADIUS
  const ay = py * SPHERE_RADIUS
  const az = pz * SPHERE_RADIUS

  const lx = cosPhi * ax + sinPhi * az
  const ly = sinPhi * sinTheta * ax + cosTheta * ay - cosPhi * sinTheta * az
  const lz = -sinPhi * cosTheta * ax + sinTheta * ay + cosPhi * cosTheta * az

  const half = (view.scale * view.height) / 2
  return {
    x: view.width / 2 + lx * half,
    y: view.height / 2 - ly * half,
    z: lz,
    visible: lz >= 0,
  }
}

/** Radius of the drawn globe in CSS pixels. */
export function globeRadius(view: View): number {
  return (SPHERE_RADIUS * view.scale * view.height) / 2
}

/**
 * The coordinate under a canvas point, or null when the point misses the globe.
 * Inverts `project` by transposing its (orthonormal) rotation.
 */
export function invert(x: number, y: number, view: View): { lat: number; lon: number } | null {
  const half = (view.scale * view.height) / 2
  const lx = (x - view.width / 2) / half
  const ly = (view.height / 2 - y) / half
  const squared = lx * lx + ly * ly
  const radiusSquared = SPHERE_RADIUS * SPHERE_RADIUS
  if (squared > radiusSquared) return null
  const lz = Math.sqrt(radiusSquared - squared)

  const cosPhi = Math.cos(view.phi)
  const sinPhi = Math.sin(view.phi)
  const cosTheta = Math.cos(view.theta)
  const sinTheta = Math.sin(view.theta)

  const ax = cosPhi * lx + sinPhi * sinTheta * ly - sinPhi * cosTheta * lz
  const ay = cosTheta * ly + sinTheta * lz
  const az = sinPhi * lx - cosPhi * sinTheta * ly + cosPhi * cosTheta * lz

  const nx = ax / SPHERE_RADIUS
  const ny = Math.min(1, Math.max(-1, ay / SPHERE_RADIUS))
  const nz = az / SPHERE_RADIUS

  return {
    lat: (Math.asin(ny) * 180) / Math.PI,
    lon: wrapLongitude((Math.atan2(nz, -nx) * 180) / Math.PI + 180),
  }
}

export function wrapLongitude(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

/** The phi/theta that centre a coordinate on screen. */
export function lookAt(lat: number, lon: number): { phi: number; theta: number } {
  return {
    phi: (3 * Math.PI) / 2 - (lon * Math.PI) / 180,
    theta: (lat * Math.PI) / 180,
  }
}

/** The coordinate currently at the centre of the globe. */
export function centreOf(view: View): { lat: number; lon: number } {
  return {
    lat: (view.theta * 180) / Math.PI,
    lon: wrapLongitude((((3 * Math.PI) / 2 - view.phi) * 180) / Math.PI),
  }
}
