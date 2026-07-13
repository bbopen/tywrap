/**
 * useThreeScene — Vue composable that builds and animates the tywrap hero 3D scene.
 *
 * "The Impossible Wrap": an original sculpture of the tywrap idea. A machined
 * graphite triangle (the rigid TypeScript structure) has a port bored through
 * each beam, and an amber python threads itself through all three, head
 * emerging toward the viewer. Sapphire type-current pulses circulate along the
 * frame. Concept inspired by classic impossible-triangle snake illusions; all
 * geometry, materials, and animation here are original and generated in code —
 * the repo ships no model or texture binaries.
 *
 * The snake's skin is ~5k individually placed, overlapping scale plates
 * (InstancedMesh, matrices baked once at startup) over a dark under-body tube,
 * lit by a generated room environment for PBR reflections.
 */

import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  BloomEffect,
  VignetteEffect,
} from 'postprocessing'

export interface ThreeSceneOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

export interface ThreeSceneReturn {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  start: () => void
  pause: () => void
  resume: () => void
  dispose: () => void
  resize: (w: number, h: number) => void
  onScroll: (scrollY: number) => void
}

export function useThreeScene(options: ThreeSceneOptions): ThreeSceneReturn {
  const { canvas, width, height } = options

  const scene = new THREE.Scene()

  // Manual frame timing instead of THREE.Clock (deprecated). Accumulating only
  // while the loop runs keeps the scene from jumping after a pause.
  let elapsed = 0
  let lastFrameMs: number | null = null

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
  camera.position.set(0, 0, 25)

  const mouse = new THREE.Vector2()
  const targetMouse = new THREE.Vector2()
  const scrollState = { target: 0, current: 0 }

  function onMouseMove(event: MouseEvent) {
    targetMouse.x = (event.clientX / window.innerWidth) * 2 - 1
    targetMouse.y = -(event.clientY / window.innerHeight) * 2 + 1
  }
  function onScroll(scrollY: number) { scrollState.target = scrollY }

  const dpr = Math.min(Math.max(1, window.devicePixelRatio), 2)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(new THREE.Color('#020205'), 1)
  renderer.setPixelRatio(dpr)
  renderer.setSize(width, height)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  // Generated room environment: PBR reflections with no HDR asset shipped.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTexture

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  })
  composer.addPass(new RenderPass(scene, camera))
  const bloomEffect = new BloomEffect({
    luminanceThreshold: 0.55,
    mipmapBlur: true,
    intensity: 0.9,
  })
  const vignetteEffect = new VignetteEffect({ eskil: false, offset: 0.3, darkness: 0.85 })
  composer.addPass(new EffectPass(camera, bloomEffect, vignetteEffect))

  // Everything lives in one group parked on the right half of the frame.
  const coreGroup = new THREE.Group()
  const CORE_X = 4.8
  const CORE_SCALE = 0.62
  coreGroup.position.set(CORE_X, -0.4, 0)
  coreGroup.scale.setScalar(CORE_SCALE)
  scene.add(coreGroup)

  const disposables: Array<{ dispose: () => void }> = []
  function track<T extends { dispose: () => void }>(obj: T): T {
    disposables.push(obj)
    return obj
  }

  // ---------------------------------------------------------------------------
  // Triangle frame: three beams, each with a circular port the snake threads.
  // ---------------------------------------------------------------------------
  const TRI_R = 6.2 // circumradius of the triangle's corner centers
  const BEAM_W = 1.7 // beam cross-section width (in triangle plane)
  const BEAM_D = 1.7 // beam depth (out of plane)
  const HOLE_R = 1.02

  const graphite = track(new THREE.MeshStandardMaterial({
    color: 0x2b2e36,
    metalness: 0.85,
    roughness: 0.38,
  }))
  const grommetMat = track(new THREE.MeshStandardMaterial({
    color: 0x0b1e3d,
    metalness: 0.6,
    roughness: 0.3,
    emissive: 0x1d4ed8,
    emissiveIntensity: 1.1,
  }))

  const corners: THREE.Vector3[] = []
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3
    corners.push(new THREE.Vector3(Math.cos(a) * TRI_R, Math.sin(a) * TRI_R, 0))
  }

  const holeCenters: THREE.Vector3[] = []
  const frameGroup = new THREE.Group()
  coreGroup.add(frameGroup)

  for (let i = 0; i < 3; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 3]
    const mid = a.clone().add(b).multiplyScalar(0.5)
    holeCenters.push(mid.clone())
    const len = a.distanceTo(b)

    // Beam: extruded rectangle with a circular hole at its center.
    const shape = new THREE.Shape()
    shape.moveTo(-len / 2, -BEAM_W / 2)
    shape.lineTo(len / 2, -BEAM_W / 2)
    shape.lineTo(len / 2, BEAM_W / 2)
    shape.lineTo(-len / 2, BEAM_W / 2)
    shape.closePath()
    const hole = new THREE.Path()
    hole.absarc(0, 0, HOLE_R * 0.86, 0, Math.PI * 2, true)
    shape.holes.push(hole)

    const beamGeo = track(new THREE.ExtrudeGeometry(shape, {
      depth: BEAM_D,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.07,
      bevelSegments: 2,
      curveSegments: 40,
    }))
    const beam = new THREE.Mesh(beamGeo, graphite)
    const dir = b.clone().sub(a)
    beam.position.copy(mid)
    beam.position.z = -BEAM_D / 2
    beam.rotation.z = Math.atan2(dir.y, dir.x)
    frameGroup.add(beam)

    // Corner joint: a machined puck, rotation-agnostic.
    const jointGeo = track(new THREE.CylinderGeometry(BEAM_W * 0.78, BEAM_W * 0.78, BEAM_D * 1.12, 32))
    const joint = new THREE.Mesh(jointGeo, graphite)
    joint.position.copy(a)
    joint.rotation.x = Math.PI / 2
    frameGroup.add(joint)

    // Sapphire grommet rims on both faces of each port.
    for (const zSide of [-1, 1]) {
      const grommetGeo = track(new THREE.TorusGeometry(HOLE_R * 0.88, 0.09, 16, 48))
      const grommet = new THREE.Mesh(grommetGeo, grommetMat)
      grommet.position.copy(mid)
      grommet.position.z = (BEAM_D / 2) * zSide
      frameGroup.add(grommet)
    }
  }

  // ---------------------------------------------------------------------------
  // Serpent path: a closed loop threading all three ports, weaving front/back.
  // ---------------------------------------------------------------------------
  const OUT_R = 8.4 // how far the coils swing outside the triangle
  const pathPoints: THREE.Vector3[] = []
  for (let i = 0; i < 3; i++) {
    const mid = holeCenters[i]
    const outDir = mid.clone().normalize()
    const side = new THREE.Vector3(-outDir.y, outDir.x, 0)
    const zSign = i % 2 === 0 ? 1 : -1
    // Approach, cross the port perpendicular to the beam, exit the other side.
    pathPoints.push(mid.clone().addScaledVector(side, -2.4).setZ(2.0 * zSign))
    pathPoints.push(mid.clone().setZ(1.15 * zSign))
    pathPoints.push(mid.clone().setZ(-1.15 * zSign))
    if (i === 1) {
      // The head lives on this exit: swing low into the open space below the
      // feature panel, leaning toward the camera.
      pathPoints.push(mid.clone().addScaledVector(side, 2.4).add(new THREE.Vector3(0, -2.1, 0)).setZ(2.4))
    } else {
      pathPoints.push(mid.clone().addScaledVector(side, 2.4).setZ(-2.0 * zSign))
    }
    pathPoints.push(outDir.clone().multiplyScalar(OUT_R).addScaledVector(side, 3.2).setZ(-0.9 * zSign))
  }
  const spine = new THREE.CatmullRomCurve3(pathPoints, true, 'centripetal', 0.85)

  // The snake occupies a window of the closed loop; head and tail taper inside
  // it. The window is chosen so the head emerges from the upper-left port into
  // the open gap beside the text and the tail trails off an outer coil.
  const SNAKE_START = 0.545
  const SNAKE_END = 1.465 // wraps past 1.0; sampled mod 1; head exits the bottom port toward the viewer
  const BODY_R = 0.62
  const wrapU = (u: number) => ((u % 1) + 1) % 1

  function bodyRadius(u: number): number {
    if (u < SNAKE_START || u > SNAKE_END) return 0
    const t = (u - SNAKE_START) / (SNAKE_END - SNAKE_START)
    let r = BODY_R
    r *= Math.min(1, Math.pow(t / 0.28, 0.8)) // tail taper (long)
    const headT = Math.min(1, (1 - t) / 0.05) // neck: taper to a stub the skull covers
    r *= 0.55 + 0.45 * Math.pow(headT, 0.7)
    return r
  }

  // Under-body: a dark tube so gaps between scale plates never show background.
  const isMobile = width < 768
  const TUBE_SEG = isMobile ? 400 : 800
  const underBodyMat = track(new THREE.MeshStandardMaterial({
    color: 0x2a1808,
    metalness: 0.0,
    roughness: 0.75,
  }))
  class SnakeCurve extends THREE.Curve<THREE.Vector3> {
    getPoint(t: number): THREE.Vector3 {
      const u = SNAKE_START + t * (SNAKE_END - SNAKE_START)
      return spine.getPointAt(wrapU(u))
    }
  }
  const underGeo = track(new THREE.TubeGeometry(new SnakeCurve(), TUBE_SEG, BODY_R * 0.9, 14, false))
  // Taper the under-body by scaling rings toward the ends.
  {
    const pos = underGeo.attributes.position as THREE.BufferAttribute
    const rings = TUBE_SEG + 1
    const radial = 14 + 1
    const center = new THREE.Vector3()
    for (let i = 0; i < rings; i++) {
      const t = i / TUBE_SEG
      const u = SNAKE_START + t * (SNAKE_END - SNAKE_START)
      const scale = bodyRadius(u) / BODY_R
      spine.getPointAt(wrapU(u), center)
      for (let j = 0; j < radial; j++) {
        const k = i * radial + j
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
        pos.setXYZ(k, center.x + (x - center.x) * scale, center.y + (y - center.y) * scale, center.z + (z - center.z) * scale)
      }
    }
    pos.needsUpdate = true
    underGeo.computeVertexNormals()
  }
  const underBody = new THREE.Mesh(underGeo, underBodyMat)
  coreGroup.add(underBody)

  // ---------------------------------------------------------------------------
  // Scale plates: staggered rings of overlapping elliptical domes, baked once.
  // ---------------------------------------------------------------------------
  const frames = spine.computeFrenetFrames(2048, true)
  function frameAt(uRaw: number) {
    const u = wrapU(uRaw)
    const idx = Math.min(2047, Math.max(0, Math.round(u * 2048))) % 2048
    return {
      p: spine.getPointAt(u),
      t: frames.tangents[idx],
      n: frames.normals[idx],
      b: frames.binormals[idx],
    }
  }

  const SCALE_LEN = 0.34 // along the body
  const loopLen = spine.getLength()
  const RING_COUNT = Math.floor((loopLen * (SNAKE_END - SNAKE_START)) / (SCALE_LEN * 0.5))

  // Elliptical dome plate, long axis +x, dome +y, thin.
  const plateGeo = track(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2))
  plateGeo.scale(SCALE_LEN * 0.62, 0.075, SCALE_LEN * 0.46)

  const scaleMat = track(new THREE.MeshStandardMaterial({
    color: 0xd08a2e,
    metalness: 0.15,
    roughness: 0.42,
  }))

  const placements: Array<{ u: number; angle: number; r: number }> = []
  for (let ring = 0; ring < RING_COUNT; ring++) {
    const t = ring / RING_COUNT
    const u = SNAKE_START + t * (SNAKE_END - SNAKE_START)
    const r = bodyRadius(u)
    if (r < 0.03) continue
    const circumference = 2 * Math.PI * r
    const count = Math.max(4, Math.round(circumference / (SCALE_LEN * 0.46)))
    const offset = (ring % 2) * 0.5
    for (let s = 0; s < count; s++) {
      placements.push({ u, angle: ((s + offset) / count) * Math.PI * 2, r })
    }
  }

  const scales = new THREE.InstancedMesh(plateGeo, scaleMat, placements.length)
  scales.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const color = new THREE.Color()
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const outward = new THREE.Vector3()
  const along = new THREE.Vector3()
  const side = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const basis = new THREE.Matrix4()
  const scl = new THREE.Vector3()
  for (let i = 0; i < placements.length; i++) {
    const { u, angle, r } = placements[i]
    const f = frameAt(u)
    outward.copy(f.n).multiplyScalar(Math.cos(angle)).addScaledVector(f.b, Math.sin(angle)).normalize()
    pos.copy(f.p).addScaledVector(outward, r * 0.98)
    along.copy(f.t).normalize()
    side.crossVectors(along, outward).normalize()
    along.crossVectors(outward, side).normalize() // re-orthogonalize
    // Tilt each plate backward (toward the tail) so rows imbricate.
    const tilt = new THREE.Quaternion().setFromAxisAngle(side, -0.5)
    basis.makeBasis(along, outward, side)
    quat.setFromRotationMatrix(basis).multiply(tilt)
    // Plates shrink with the body so the tail tip stays shingled.
    const jitter = (0.9 + Math.random() * 0.25) * Math.max(0.4, Math.sqrt(r / BODY_R))
    scl.setScalar(jitter)
    m.compose(pos, quat, scl)
    scales.setMatrixAt(i, m)
    // Ball-python patterning: dark chestnut saddles over amber ground, with a
    // pale cream belly. Saddle bands drift and vary in width along the body.
    const saddleWave =
      Math.sin(u * 145.0) * 0.6 +
      Math.sin(u * 47.0 + 1.7) * 0.3 +
      Math.sin(u * 301.0 + 0.6) * 0.25
    const inSaddle = saddleWave > 0.28
    const isBelly = outward.y < -0.62
    if (isBelly) {
      color.setHSL(0.09 + Math.random() * 0.02, 0.30 + Math.random() * 0.1, 0.62 + Math.random() * 0.1)
    } else if (inSaddle) {
      color.setHSL(0.05 + Math.random() * 0.02, 0.62 + Math.random() * 0.1, 0.13 + Math.random() * 0.07)
    } else {
      color.setHSL(0.075 + Math.random() * 0.025, 0.74 + Math.random() * 0.12, 0.40 + Math.random() * 0.14)
    }
    scales.setColorAt(i, color)
  }
  scales.instanceMatrix.needsUpdate = true
  if (scales.instanceColor) scales.instanceColor.needsUpdate = true
  coreGroup.add(scales)

  // ---------------------------------------------------------------------------
  // Head: flattened wedge + brow scales + eyes + flicking tongue.
  // ---------------------------------------------------------------------------
  const headGroup = new THREE.Group()
  coreGroup.add(headGroup)
  {
    const f = frameAt(SNAKE_END)
    headGroup.position.copy(f.p)
    coreGroup.updateMatrixWorld(true)
    // Face a point just left of the camera: a watchful 3/4 view.
    headGroup.lookAt(new THREE.Vector3(-2, 0.5, 24))
  }
  const headMat = track(new THREE.MeshStandardMaterial({
    color: 0xb9771f,
    metalness: 0.12,
    roughness: 0.55,
  }))
  const skullGeo = track(new THREE.SphereGeometry(0.88, 24, 18))
  skullGeo.scale(1.0, 0.58, 1.42)
  const skull = new THREE.Mesh(skullGeo, headMat)
  skull.position.z = 0.62
  headGroup.add(skull)
  const snoutGeo = track(new THREE.SphereGeometry(0.52, 20, 14))
  snoutGeo.scale(0.82, 0.48, 1.3)
  const snout = new THREE.Mesh(snoutGeo, headMat)
  snout.position.set(0, -0.08, 1.55)
  headGroup.add(snout)

  const eyeMat = track(new THREE.MeshStandardMaterial({
    color: 0xf5e18a,
    roughness: 0.15,
    metalness: 0.1,
    emissive: 0x8a6a10,
    emissiveIntensity: 0.35,
  }))
  const pupilMat = track(new THREE.MeshBasicMaterial({ color: 0x0a0a0a }))
  const eyeGeo = track(new THREE.SphereGeometry(0.175, 16, 16))
  const pupilGeo = track(new THREE.SphereGeometry(0.095, 12, 12))
  const browGeo = track(new THREE.SphereGeometry(0.22, 14, 10))
  for (const sideSign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.position.set(0.52 * sideSign, 0.22, 1.05)
    headGroup.add(eye)
    const pupil = new THREE.Mesh(pupilGeo, pupilMat)
    pupil.scale.set(0.4, 1, 0.9) // vertical slit
    pupil.position.set(0.6 * sideSign, 0.23, 1.12)
    headGroup.add(pupil)
    const brow = new THREE.Mesh(browGeo, headMat)
    brow.scale.set(1.0, 0.35, 1.2)
    brow.position.set(0.5 * sideSign, 0.34, 1.0)
    headGroup.add(brow)
  }

  // Shingle the skull with mini scale plates so the head matches the body.
  {
    const HEAD_PLATES = 90
    const a = 0.88, b = 0.88 * 0.58, c = 0.88 * 1.42
    const headScales = new THREE.InstancedMesh(plateGeo, scaleMat, HEAD_PLATES)
    headScales.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const dir = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    const sde = new THREE.Vector3()
    const golden = Math.PI * (3 - Math.sqrt(5))
    let placed = 0
    for (let i = 0; i < 300 && placed < HEAD_PLATES; i++) {
      const y = 1 - (i / 299) * 2
      const rad = Math.sqrt(1 - y * y)
      const th = golden * i
      dir.set(Math.cos(th) * rad, y, Math.sin(th) * rad)
      if (dir.y < -0.15) continue // belly side of the skull stays smooth
      const t = 1 / Math.sqrt((dir.x / a) ** 2 + (dir.y / b) ** 2 + (dir.z / c) ** 2)
      pos.copy(dir).multiplyScalar(t)
      nrm.set(dir.x / (a * a), dir.y / (b * b), dir.z / (c * c)).normalize()
      fwd.set(0, 0, 1).addScaledVector(nrm, -nrm.z).normalize()
      sde.crossVectors(fwd, nrm).normalize()
      fwd.crossVectors(nrm, sde).normalize()
      basis.makeBasis(fwd, nrm, sde)
      quat.setFromRotationMatrix(basis).multiply(new THREE.Quaternion().setFromAxisAngle(sde, 0.35))
      scl.setScalar(0.5 + Math.random() * 0.15)
      m.compose(pos.add(skull.position), quat, scl)
      headScales.setMatrixAt(placed, m)
      const chestnut = Math.random() < 0.25
      color.setHSL(chestnut ? 0.05 : 0.08, chestnut ? 0.6 : 0.68, chestnut ? 0.16 : 0.42 + Math.random() * 0.1)
      headScales.setColorAt(placed, color)
      placed++
    }
    headScales.count = placed
    headScales.instanceMatrix.needsUpdate = true
    if (headScales.instanceColor) headScales.instanceColor.needsUpdate = true
    headGroup.add(headScales)
    disposables.push({ dispose: () => headScales.dispose() })
  }

  // Tongue: two thin cylinders in a V, animated flick.
  const tongueGroup = new THREE.Group()
  tongueGroup.position.set(0, -0.12, 1.72)
  headGroup.add(tongueGroup)
  const tongueMat = track(new THREE.MeshStandardMaterial({ color: 0xb3123a, roughness: 0.4 }))
  const tongueGeo = track(new THREE.CylinderGeometry(0.022, 0.014, 0.7, 6))
  for (const sideSign of [-1, 1]) {
    const fork = new THREE.Mesh(tongueGeo, tongueMat)
    fork.position.set(0.045 * sideSign, 0, 0.36)
    fork.rotation.x = Math.PI / 2
    fork.rotation.z = -0.16 * sideSign
    tongueGroup.add(fork)
  }

  // ---------------------------------------------------------------------------
  // Type current: bright pulses circulating along the triangle frame edges.
  // ---------------------------------------------------------------------------
  const pulseMat = track(new THREE.MeshBasicMaterial({ color: 0x7fb2ff }))
  const pulseGeo = track(new THREE.SphereGeometry(0.1, 12, 12))
  const PULSES = 6
  const pulses: THREE.Mesh[] = []
  const trianglePath = new THREE.CatmullRomCurve3(
    corners.map(c => c.clone().setZ(BEAM_D * 0.52)),
    true, 'catmullrom', 0.02,
  )
  for (let i = 0; i < PULSES; i++) {
    const p = new THREE.Mesh(pulseGeo, pulseMat)
    frameGroup.add(p)
    pulses.push(p)
  }

  // ---------------------------------------------------------------------------
  // Ambient dust for depth.
  // ---------------------------------------------------------------------------
  const DUST_COUNT = isMobile ? 350 : 800
  const dustGeo = track(new THREE.BufferGeometry())
  const dustPos = new Float32Array(DUST_COUNT * 3)
  for (let i = 0; i < DUST_COUNT; i++) {
    dustPos[i * 3 + 0] = (Math.random() - 0.5) * 46
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 30
    dustPos[i * 3 + 2] = -8 - Math.random() * 18
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dustMat = track(new THREE.PointsMaterial({
    color: 0x33415e,
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }))
  const dust = new THREE.Points(dustGeo, dustMat)
  scene.add(dust)

  // Key light for warm highlights on the scales (env map handles fill).
  const keyLight = new THREE.DirectionalLight(0xffe0b0, 1.6)
  keyLight.position.set(-14, 12, 18)
  scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight(0x4f7fdf, 1.1)
  rimLight.position.set(16, -6, -12)
  scene.add(rimLight)
  // Warm fill so the tail and lower coils don't sink into black.
  const fillLight = new THREE.PointLight(0xff9a3c, 60, 40, 2)
  fillLight.position.set(3, -7, 9)
  scene.add(fillLight)

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------
  let rafId: number | null = null
  let started = false

  function animate() {
    rafId = requestAnimationFrame(animate)
    const nowMs = performance.now()
    if (lastFrameMs !== null) elapsed += (nowMs - lastFrameMs) / 1000
    lastFrameMs = nowMs

    scrollState.current += (scrollState.target - scrollState.current) * 0.05
    mouse.x += (targetMouse.x - mouse.x) * 0.05
    mouse.y += (targetMouse.y - mouse.y) * 0.05

    // Slow presentational oscillation plus mouse parallax.
    coreGroup.rotation.y = Math.sin(elapsed * 0.16) * 0.22 + mouse.x * 0.1
    coreGroup.rotation.x = Math.sin(elapsed * 0.11) * 0.07 + mouse.y * -0.06
    coreGroup.position.y = Math.sin(elapsed * 0.4) * 0.15 - scrollState.current * 0.01

    // Breathing: the whole serpent swells almost imperceptibly.
    const breath = 1 + Math.sin(elapsed * 1.1) * 0.006
    coreGroup.scale.setScalar(breath)

    // Type-current pulses race around the frame.
    for (let i = 0; i < PULSES; i++) {
      const t = (elapsed * 0.06 + i / PULSES) % 1
      trianglePath.getPointAt(t, pulses[i].position)
      const flicker = 0.7 + 0.3 * Math.sin(elapsed * 7 + i * 2.4)
      pulses[i].scale.setScalar(flicker)
    }

    // Tongue flick: brief dart every few seconds.
    const cycle = elapsed % 5.5
    const flick = cycle < 0.5 ? Math.sin((cycle / 0.5) * Math.PI) : 0
    tongueGroup.scale.z = 0.1 + flick
    tongueGroup.visible = flick > 0.05

    // Head micro-motion: a slow, watchful sway.
    headGroup.rotation.y = Math.sin(elapsed * 0.5) * 0.08
    headGroup.rotation.x = Math.sin(elapsed * 0.35) * 0.05

    composer.render()
  }

  function start() {
    if (started) return
    started = true
    window.addEventListener('mousemove', onMouseMove)
    animate()
  }

  function pause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    lastFrameMs = null
  }

  function resume() {
    if (!started || rafId !== null) return
    animate()
  }

  function dispose() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    window.removeEventListener('mousemove', onMouseMove)
    for (const d of disposables) d.dispose()
    scales.dispose()
    envTexture.dispose()
    pmrem.dispose()
    composer.dispose()
    renderer.dispose()
  }

  function resize(w: number, h: number) {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }

  return { scene, camera, renderer, start, pause, resume, dispose, resize, onScroll }
}
