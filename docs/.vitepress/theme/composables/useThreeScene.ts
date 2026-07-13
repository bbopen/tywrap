/**
 * useThreeScene — Vue composable that builds and animates the tywrap hero 3D scene.
 *
 * "The Impossible Wrap": an original sculpture of the tywrap idea. A machined
 * graphite triangle (the rigid TypeScript structure) has a port bored through
 * each beam, and an amber python perpetually slithers through all three,
 * circulating the loop forever. Sapphire type-current pulses run along the
 * frame. Concept inspired by classic impossible-triangle snake illusions; all
 * geometry, materials, and animation here are original and generated in code —
 * the repo ships no model or texture binaries.
 *
 * The snake's skin is ~5k overlapping scale plates. Their placement is
 * computed on the GPU: the closed spine's Frenet frames are baked into a
 * float DataTexture, each plate carries its fixed offset behind the head, and
 * a patched MeshStandardMaterial vertex shader positions every plate from a
 * single uHead uniform. Advancing uHead slides the whole body along the loop,
 * so the serpent threads the ports continuously at zero per-frame JS cost for
 * the body. The head is one small group repositioned in JS each frame.
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
  renderer.toneMappingExposure = 0.95

  // Generated room environment: PBR reflections with no HDR asset shipped.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTexture

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  })
  composer.addPass(new RenderPass(scene, camera))
  const bloomEffect = new BloomEffect({
    luminanceThreshold: 0.78,
    mipmapBlur: true,
    intensity: 0.7,
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
      // Swing low through the open space below the feature panel, leaning
      // toward the camera: the stretch where the head shows off.
      pathPoints.push(mid.clone().addScaledVector(side, 2.4).add(new THREE.Vector3(0, -2.7, 0)).setZ(2.4))
    } else {
      pathPoints.push(mid.clone().addScaledVector(side, 2.4).setZ(-2.0 * zSign))
    }
    pathPoints.push(outDir.clone().multiplyScalar(OUT_R).addScaledVector(side, 3.2).setZ(-0.9 * zSign))
  }
  const spine = new THREE.CatmullRomCurve3(pathPoints, true, 'centripetal', 0.85)

  // The snake is a moving window of the closed loop: the head sits at uHead,
  // the body trails LEN behind it. Radius depends only on offset-behind-head,
  // so plate sizes and colors bake once while positions ride uHead on the GPU.
  const BODY_R = 0.62
  const LEN = 0.86 // body length as a fraction of the loop

  function bodyRadius(offset: number): number {
    if (offset < 0 || offset > LEN) return 0
    const t = offset / LEN // 0 at head, 1 at tail tip
    let r = BODY_R
    r *= Math.min(1, Math.pow((1 - t) / 0.28, 0.8)) // long tail taper
    const headT = Math.min(1, t / 0.05) // neck stub the skull covers
    r *= 0.55 + 0.45 * Math.pow(headT, 0.7)
    return r
  }

  // --- Frenet frames baked into a float texture (rows: pos, T, N, B) --------
  const FRAME_SAMPLES = 2048
  const loopFrames = spine.computeFrenetFrames(FRAME_SAMPLES, true)
  const frameData = new Float32Array(FRAME_SAMPLES * 4 * 4)
  const samplePoint = new THREE.Vector3()
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const u = i / FRAME_SAMPLES
    spine.getPointAt(u, samplePoint)
    const rows = [samplePoint, loopFrames.tangents[i], loopFrames.normals[i], loopFrames.binormals[i]]
    for (let row = 0; row < 4; row++) {
      const k = (row * FRAME_SAMPLES + i) * 4
      frameData[k + 0] = rows[row].x
      frameData[k + 1] = rows[row].y
      frameData[k + 2] = rows[row].z
      frameData[k + 3] = 1
    }
  }
  const framesTex = track(new THREE.DataTexture(frameData, FRAME_SAMPLES, 4, THREE.RGBAFormat, THREE.FloatType))
  framesTex.minFilter = THREE.LinearFilter
  framesTex.magFilter = THREE.LinearFilter
  framesTex.wrapS = THREE.RepeatWrapping
  framesTex.needsUpdate = true

  const headUniform = { value: 0 }

  // Shared vertex-shader surgery: place geometry on the loop from (offset,
  // angle, radius) attributes and the frames texture. `withScale` adds the
  // per-plate scale/tilt used by the scale shingles.
  function patchLoopMaterial(material: THREE.MeshStandardMaterial, withScale: boolean) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uHead = headUniform
      shader.uniforms.uFrames = { value: framesTex }
      const decl = `
        uniform sampler2D uFrames;
        uniform float uHead;
        attribute float iOff;
        attribute float iAngle;
        attribute float iR;
        ${withScale ? 'attribute float iScale;' : ''}
      `
      const basisChunk = `
        float uLoop = fract(uHead - iOff);
        vec3 fC = texture2D(uFrames, vec2(uLoop, 0.125)).xyz;
        vec3 fT = normalize(texture2D(uFrames, vec2(uLoop, 0.375)).xyz);
        vec3 fN = normalize(texture2D(uFrames, vec2(uLoop, 0.625)).xyz);
        vec3 fB = normalize(texture2D(uFrames, vec2(uLoop, 0.875)).xyz);
        vec3 outwardV = normalize(cos(iAngle) * fN + sin(iAngle) * fB);
        vec3 sideV = normalize(cross(fT, outwardV));
        vec3 alongV = normalize(cross(outwardV, sideV));
        mat3 loopBasis = mat3(alongV, outwardV, sideV);
        const float ctilt = 0.8775826;
        const float stilt = -0.4794255;
      `
      const normalChunk = withScale
        ? `${basisChunk}
           vec3 objectNormal = loopBasis * vec3(ctilt * normal.x + stilt * normal.y, -stilt * normal.x + ctilt * normal.y, normal.z);`
        : `${basisChunk}
           vec3 objectNormal = outwardV;`
      const beginChunk = withScale
        ? `vec3 pLocal = position * iScale;
           pLocal = vec3(ctilt * pLocal.x + stilt * pLocal.y, -stilt * pLocal.x + ctilt * pLocal.y, pLocal.z);
           vec3 transformed = fC + outwardV * iR + loopBasis * pLocal;`
        : `vec3 transformed = fC + outwardV * iR;`
      shader.vertexShader = decl + shader.vertexShader
        .replace('#include <beginnormal_vertex>', normalChunk)
        .replace('#include <begin_vertex>', beginChunk)
    }
    // uHead/uFrames make each compile unique; avoid program cache collisions.
    material.customProgramCacheKey = () => `loop-${withScale ? 'plates' : 'tube'}`
  }

  // --- Under-body tube: a dark sleeve so plate gaps never show background ----
  const isMobile = width < 768
  const TUBE_SEG = isMobile ? 360 : 720
  const TUBE_RADIAL = 12
  const underBodyMat = track(new THREE.MeshStandardMaterial({
    color: 0x2a1808,
    metalness: 0.0,
    roughness: 0.75,
  }))
  patchLoopMaterial(underBodyMat, false)
  {
    const rings = TUBE_SEG + 1
    const radial = TUBE_RADIAL + 1
    const count = rings * radial
    const posAttr = new Float32Array(count * 3) // placeholder; shader replaces it
    const offAttr = new Float32Array(count)
    const angAttr = new Float32Array(count)
    const rAttr = new Float32Array(count)
    for (let i = 0; i < rings; i++) {
      const offset = (i / TUBE_SEG) * LEN
      const r = bodyRadius(offset) * 0.92
      for (let j = 0; j < radial; j++) {
        const k = i * radial + j
        offAttr[k] = offset
        angAttr[k] = (j / TUBE_RADIAL) * Math.PI * 2
        rAttr[k] = r
      }
    }
    const idx: number[] = []
    for (let i = 0; i < TUBE_SEG; i++) {
      for (let j = 0; j < TUBE_RADIAL; j++) {
        const a = i * radial + j
        const b = a + radial
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    const tubeGeo = track(new THREE.BufferGeometry())
    tubeGeo.setAttribute('position', new THREE.BufferAttribute(posAttr, 3))
    tubeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    tubeGeo.setAttribute('iOff', new THREE.BufferAttribute(offAttr, 1))
    tubeGeo.setAttribute('iAngle', new THREE.BufferAttribute(angAttr, 1))
    tubeGeo.setAttribute('iR', new THREE.BufferAttribute(rAttr, 1))
    tubeGeo.setIndex(idx)
    tubeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 30)
    const underBody = new THREE.Mesh(tubeGeo, underBodyMat)
    underBody.frustumCulled = false
    coreGroup.add(underBody)
  }

  // ---------------------------------------------------------------------------
  // Scale plates: staggered rings of overlapping domes riding the loop on GPU.
  // ---------------------------------------------------------------------------
  const SCALE_LEN = 0.34
  const loopLen = spine.getLength()
  const RING_COUNT = Math.floor((loopLen * LEN) / (SCALE_LEN * 0.5))

  const plateGeo = track(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2))
  plateGeo.scale(SCALE_LEN * 0.62, 0.075, SCALE_LEN * 0.46)

  const scaleMat = track(new THREE.MeshStandardMaterial({
    color: 0xd08a2e, // amber ground; per-plate colors multiply against it
    metalness: 0.15,
    roughness: 0.42,
    vertexColors: true,
  }))
  patchLoopMaterial(scaleMat, true)

  type Placement = { off: number; angle: number; r: number }
  const placements: Placement[] = []
  for (let ring = 0; ring < RING_COUNT; ring++) {
    const offset = (ring / RING_COUNT) * LEN
    const r = bodyRadius(offset)
    if (r < 0.03) continue
    const circumference = 2 * Math.PI * r
    const count = Math.max(4, Math.round(circumference / (SCALE_LEN * 0.46)))
    const stagger = (ring % 2) * 0.5
    for (let s = 0; s < count; s++) {
      placements.push({ off: offset, angle: ((s + stagger) / count) * Math.PI * 2, r })
    }
  }

  const N = placements.length
  const instGeo = track(new THREE.InstancedBufferGeometry())
  instGeo.index = plateGeo.index
  instGeo.setAttribute('position', plateGeo.getAttribute('position'))
  instGeo.setAttribute('normal', plateGeo.getAttribute('normal'))
  instGeo.setAttribute('uv', plateGeo.getAttribute('uv'))
  instGeo.instanceCount = N
  instGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 30)

  const offArr = new Float32Array(N)
  const angArr = new Float32Array(N)
  const rArr = new Float32Array(N)
  const sclArr = new Float32Array(N)
  const colArr = new Float32Array(N * 3)
  const color = new THREE.Color()
  for (let i = 0; i < N; i++) {
    const { off, angle, r } = placements[i]
    offArr[i] = off
    angArr[i] = angle
    rArr[i] = r * 0.98
    sclArr[i] = (0.9 + Math.random() * 0.25) * Math.max(0.4, Math.sqrt(r / BODY_R))
    // Ball-python patterning keyed to the body (it rides along as it moves):
    // dark chestnut saddles over amber ground, pale frame-relative belly.
    const saddleWave =
      Math.sin(off * 145.0) * 0.6 +
      Math.sin(off * 47.0 + 1.7) * 0.3 +
      Math.sin(off * 301.0 + 0.6) * 0.25
    const inSaddle = saddleWave > 0.28
    const isBelly = Math.cos(angle) < -0.62
    if (isBelly) {
      color.setHSL(0.09 + Math.random() * 0.02, 0.30 + Math.random() * 0.1, 0.62 + Math.random() * 0.1)
    } else if (inSaddle) {
      color.setHSL(0.05 + Math.random() * 0.02, 0.62 + Math.random() * 0.1, 0.13 + Math.random() * 0.07)
    } else {
      color.setHSL(0.075 + Math.random() * 0.025, 0.74 + Math.random() * 0.12, 0.40 + Math.random() * 0.14)
    }
    colArr[i * 3 + 0] = color.r
    colArr[i * 3 + 1] = color.g
    colArr[i * 3 + 2] = color.b
  }
  instGeo.setAttribute('iOff', new THREE.InstancedBufferAttribute(offArr, 1))
  instGeo.setAttribute('iAngle', new THREE.InstancedBufferAttribute(angArr, 1))
  instGeo.setAttribute('iR', new THREE.InstancedBufferAttribute(rArr, 1))
  instGeo.setAttribute('iScale', new THREE.InstancedBufferAttribute(sclArr, 1))
  instGeo.setAttribute('color', new THREE.InstancedBufferAttribute(colArr, 3))
  const scales = new THREE.Mesh(instGeo, scaleMat)
  scales.frustumCulled = false
  coreGroup.add(scales)

  // ---------------------------------------------------------------------------
  // Head: flattened wedge + shingled crown + eyes + flicking tongue.
  // Positioned in JS each frame at uHead.
  // ---------------------------------------------------------------------------
  const headGroup = new THREE.Group()
  coreGroup.add(headGroup)
  const headMat = track(new THREE.MeshStandardMaterial({
    color: 0xb9771f,
    metalness: 0.12,
    roughness: 0.55,
  }))

  // Lofted python head: elliptical cross-sections along the head's length.
  // z runs 0 (neck joint) .. 1 (snout tip), scaled by HEAD_L. The skull is
  // broad and flat behind the eyes, the snout tapers, droops slightly, and
  // rounds off; the jaw is flatter than the crown and carries a mouth crease.
  const HEAD_L = 2.45
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const headWidth = (z: number) => 0.36 + 0.3 * ss(0.05, 0.38, z) - 0.49 * ss(0.55, 0.97, z)
  const headTop = (z: number) => 0.32 + 0.1 * ss(0.05, 0.4, z) - 0.3 * ss(0.5, 0.97, z)
  const headBottom = (z: number) => 0.3 - 0.18 * ss(0.5, 0.97, z)
  const headDroop = (z: number) => -0.09 * ss(0.5, 1, z)
  const headCap = (z: number) => {
    const t = Math.max(0, (z - 0.9) / 0.1)
    return Math.sqrt(Math.max(0, 1 - t * t))
  }
  function headSurface(phi: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    // phi measured from +x (the snake's right); pi/2 is the crown.
    const cap = headCap(z)
    const sn = Math.sin(phi)
    const h = sn > 0 ? headTop(z) : headBottom(z)
    // Mouth crease: a shallow groove just below the widest line of each side.
    const mouthPhi = Math.min(Math.abs(phi + 0.14), Math.abs(phi - Math.PI - 0.14), Math.abs(phi + Math.PI - 0.14))
    const crease = 1 - 0.07 * Math.exp(-(mouthPhi * mouthPhi) / 0.012) * ss(0.3, 0.55, z)
    out.set(
      headWidth(z) * cap * Math.cos(phi) * crease,
      h * cap * sn * crease + headDroop(z),
      z * HEAD_L,
    )
    return out
  }
  {
    const SEC = 40
    const RAD = 44
    const count = (SEC + 1) * (RAD + 1)
    const hp = new Float32Array(count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i <= SEC; i++) {
      const z = i / SEC
      for (let j = 0; j <= RAD; j++) {
        const phi = (j / RAD) * Math.PI * 2
        headSurface(phi, z, v)
        const k = (i * (RAD + 1) + j) * 3
        hp[k] = v.x; hp[k + 1] = v.y; hp[k + 2] = v.z
      }
    }
    const idx: number[] = []
    for (let i = 0; i < SEC; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = i * (RAD + 1) + j
        const b = a + RAD + 1
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    const headGeo = track(new THREE.BufferGeometry())
    headGeo.setAttribute('position', new THREE.BufferAttribute(hp, 3))
    headGeo.setIndex(idx)
    headGeo.computeVertexNormals()
    const headMesh = new THREE.Mesh(headGeo, headMat)
    headMesh.position.z = -0.15 // tuck the neck joint into the body stub
    headGroup.add(headMesh)
  }

  // Eyes sit just behind the widest point, high on the sides, under a shelf
  // the loft's crown provides naturally. Slit pupils face forward.
  const eyeMat = track(new THREE.MeshStandardMaterial({
    color: 0xf5e18a,
    roughness: 0.15,
    metalness: 0.1,
    emissive: 0x8a6a10,
    emissiveIntensity: 0.35,
  }))
  const pupilMat = track(new THREE.MeshBasicMaterial({ color: 0x0a0a0a }))
  const eyeGeo = track(new THREE.SphereGeometry(0.16, 16, 16))
  const pupilGeo = track(new THREE.SphereGeometry(0.085, 12, 12))
  const nostrilGeo = track(new THREE.SphereGeometry(0.045, 8, 8))
  {
    const zEye = 0.5
    const wE = headWidth(zEye) * headCap(zEye)
    const hE = headTop(zEye) * headCap(zEye)
    for (const sideSign of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(wE * 0.78 * sideSign, hE * 0.52 + headDroop(zEye), zEye * HEAD_L - 0.15)
      headGroup.add(eye)
      const pupil = new THREE.Mesh(pupilGeo, pupilMat)
      pupil.scale.set(0.38, 1, 0.9) // vertical slit
      pupil.position.copy(eye.position)
      pupil.position.x += 0.07 * sideSign
      pupil.position.z += 0.09
      headGroup.add(pupil)
    }
    const zN = 0.9
    const wN = headWidth(zN) * headCap(zN)
    for (const sideSign of [-1, 1]) {
      const nostril = new THREE.Mesh(nostrilGeo, pupilMat)
      nostril.position.set(wN * 0.45 * sideSign, headTop(zN) * headCap(zN) * 0.35 + headDroop(zN), zN * HEAD_L - 0.15)
      headGroup.add(nostril)
    }
  }

  // Shingle the crown with plates fitted to the loft surface.
  {
    const rows = 13
    const perRowMax = 16
    const headScaleMat = track(new THREE.MeshStandardMaterial({
      color: 0xd08a2e,
      metalness: 0.15,
      roughness: 0.42,
    }))
    const headScales = new THREE.InstancedMesh(plateGeo, headScaleMat, rows * perRowMax)
    headScales.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const sp = new THREE.Vector3()
    const spNext = new THREE.Vector3()
    const spSide = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    const sde = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const basis = new THREE.Matrix4()
    const scl = new THREE.Vector3()
    const m = new THREE.Matrix4()
    let placed = 0
    for (let ri = 0; ri < rows; ri++) {
      const z = 0.08 + (ri / (rows - 1)) * 0.82
      const zEyeGap = Math.abs(z - 0.5)
      const w = headWidth(z) * headCap(z)
      const n = Math.max(4, Math.round((w / 0.66) * perRowMax))
      const stagger = (ri % 2) * 0.5
      for (let s = 0; s < n; s++) {
        // Crown and upper sides only; skip plates that would collide with eyes.
        const phi = Math.PI * 0.12 + ((s + stagger) / (n - 0.5)) * Math.PI * 0.76
        if (zEyeGap < 0.09 && (Math.abs(phi - Math.PI * 0.28) < 0.3 || Math.abs(phi - Math.PI * 0.72) < 0.3)) continue
        headSurface(phi, z, sp)
        headSurface(phi, Math.min(1, z + 0.02), spNext)
        headSurface(phi + 0.04, z, spSide)
        fwd.copy(spNext).sub(sp).normalize()
        sde.copy(spSide).sub(sp).normalize()
        nrm.crossVectors(sde, fwd).normalize()
        if (nrm.y < 0) nrm.negate()
        sde.crossVectors(fwd, nrm).normalize()
        fwd.crossVectors(nrm, sde).normalize()
        basis.makeBasis(fwd, nrm, sde)
        quat.setFromRotationMatrix(basis).multiply(new THREE.Quaternion().setFromAxisAngle(sde, 0.3))
        scl.setScalar((0.42 + Math.random() * 0.1) * (0.55 + 0.7 * w))
        sp.z -= 0.15 // headMesh offset
        m.compose(sp, quat, scl)
        headScales.setMatrixAt(placed, m)
        const chestnut = Math.random() < 0.25
        color.setHSL(chestnut ? 0.05 : 0.08, chestnut ? 0.6 : 0.68, chestnut ? 0.16 : 0.42 + Math.random() * 0.1)
        headScales.setColorAt(placed, color)
        placed++
      }
    }
    headScales.count = placed
    headScales.instanceMatrix.needsUpdate = true
    if (headScales.instanceColor) headScales.instanceColor.needsUpdate = true
    headGroup.add(headScales)
    disposables.push({ dispose: () => headScales.dispose() })
  }

  // Tongue: two thin cylinders in a V, animated flick.
  const tongueGroup = new THREE.Group()
  tongueGroup.position.set(0, headDroop(1) - 0.06, HEAD_L - 0.18)
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
  const SLITHER_SPEED = 0.022 // loops per second: a full circuit every ~45s
  const headPos = new THREE.Vector3()
  const headTangent = new THREE.Vector3()
  const headTarget = new THREE.Vector3()
  const camWorld = new THREE.Vector3()

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
    coreGroup.rotation.y = Math.sin(elapsed * 0.16) * 0.18 + mouse.x * 0.1
    coreGroup.rotation.x = Math.sin(elapsed * 0.11) * 0.06 + mouse.y * -0.06
    coreGroup.position.y = -0.4 + Math.sin(elapsed * 0.4) * 0.12 - scrollState.current * 0.01

    // The serpent circulates the loop forever.
    const uHead = (elapsed * SLITHER_SPEED) % 1
    headUniform.value = uHead

    // Head rides the loop, facing along its travel with a lean to the camera.
    // The lean fades to zero near the ports so the head always points into
    // the hole it is threading instead of side-eyeing the viewer through it.
    spine.getPointAt(uHead, headPos)
    spine.getTangentAt(uHead, headTangent)
    headGroup.position.copy(headPos)
    camWorld.copy(camera.position)
    coreGroup.worldToLocal(camWorld)
    let portDist = Infinity
    for (const h of holeCenters) portDist = Math.min(portDist, headPos.distanceTo(h))
    const lean = 0.18 * THREE.MathUtils.smoothstep(portDist, 2.4, 4.8)
    headTarget.copy(headPos).addScaledVector(headTangent, 4)
    headTarget.lerp(camWorld, lean)
    headGroup.lookAt(coreGroup.localToWorld(headTarget.clone()))

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
