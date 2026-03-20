/**
 * useThreeScene — Vue composable that builds and animates the tywrap hero 3D scene.
 *
 * This is a direct port of the React Three Fiber scene from bbopen/tywrap-hero-visual,
 * using raw Three.js + postprocessing instead of R3F / drei abstractions.
 */

import * as THREE from 'three'
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  BloomEffect,
} from 'postprocessing'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  dispose: () => void
  resize: (w: number, h: number) => void
}

// drei "city" preset HDR environment map URL
// This is the same file drei loads for <Environment preset="city" />
const CITY_HDR_URL =
  'https://raw.githubusercontent.com/pmndrs/drei-assets/master/hdri/city.hdr'

/**
 * Load HDR environment map and apply to scene.
 * Falls back to fill lights if loading fails.
 */
function loadEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): void {
  import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    pmremGenerator.compileEquirectangularShader()

    new RGBELoader().load(
      CITY_HDR_URL,
      (hdrTexture) => {
        const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture
        scene.environment = envMap
        hdrTexture.dispose()
        pmremGenerator.dispose()
      },
      undefined,
      () => {
        // Fallback: add fill lights if HDR fails to load
        const fill1 = new THREE.DirectionalLight(0xfff0dd, 0.4)
        fill1.position.set(-5, 5, 5)
        scene.add(fill1)

        const fill2 = new THREE.DirectionalLight(0xd0e0ff, 0.3)
        fill2.position.set(5, -3, -5)
        scene.add(fill2)
        pmremGenerator.dispose()
      },
    )
  })
}

export function useThreeScene(options: ThreeSceneOptions): ThreeSceneReturn {
  const { canvas, width, height } = options

  // -----------------------------------------------------------------------
  // Scene + Clock
  // -----------------------------------------------------------------------
  const scene = new THREE.Scene()
  const clock = new THREE.Clock()

  // -----------------------------------------------------------------------
  // Camera — fov=45, position=[0,0,12], near=0.1, far=100
  // -----------------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
  camera.position.set(0, -3, 16)

  // -----------------------------------------------------------------------
  // Renderer — antialias=false, alpha=true, powerPreference='high-performance'
  // dpr clamped to [1, 2]
  // -----------------------------------------------------------------------
  const dpr = Math.min(Math.max(1, window.devicePixelRatio), 2)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(dpr)
  renderer.setSize(width, height)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.8
  renderer.outputColorSpace = THREE.SRGBColorSpace

  // -----------------------------------------------------------------------
  // Lights
  // -----------------------------------------------------------------------

  // Ambient
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2)
  scene.add(ambientLight)

  // Point light #1 — white, position [10,10,10], intensity 1
  const pointLight1 = new THREE.PointLight(0xffffff, 1)
  pointLight1.position.set(10, 10, 10)
  scene.add(pointLight1)

  // Point light #2 — blue, position [-10,-10,-10], intensity 2
  const pointLight2 = new THREE.PointLight(0x3b82f6, 2)
  pointLight2.position.set(-10, -10, -10)
  scene.add(pointLight2)

  // Environment map — load drei "city" preset HDR for realistic reflections
  // This is critical for MeshPhysicalMaterial (glass shield) to look correct
  loadEnvironment(scene, renderer)

  // -----------------------------------------------------------------------
  // Post-processing: EffectComposer + RenderPass + BloomEffect
  // -----------------------------------------------------------------------
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  })
  composer.addPass(new RenderPass(scene, camera))

  const bloomEffect = new BloomEffect({
    luminanceThreshold: 1.2,
    mipmapBlur: true,
    intensity: 0.4,
  })
  composer.addPass(new EffectPass(camera, bloomEffect))

  // -----------------------------------------------------------------------
  // Float group — wraps Core, GlassShield, both LightStreams
  // Replicates @react-three/drei Float: speed=2, rotationIntensity=0.5,
  // floatIntensity=0.5
  // -----------------------------------------------------------------------
  const floatGroup = new THREE.Group()
  scene.add(floatGroup)
  const floatOffset = Math.random() * 10000
  const floatSpeed = 2
  const floatRotationIntensity = 0.5
  const floatFloatIntensity = 0.5

  // -----------------------------------------------------------------------
  // Core group (animated: rotation.x = elapsed*0.4, rotation.y = elapsed*0.3)
  // -----------------------------------------------------------------------
  const coreGroup = new THREE.Group()
  floatGroup.add(coreGroup)

  // Python Yellow Ring — TorusGeometry(1.2, 0.08, 32, 100), rotation.x=PI/2
  const pythonRingGeo = new THREE.TorusGeometry(1.2, 0.08, 32, 100)
  const pythonRingMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 2,
    toneMapped: false,
  })
  const pythonRing = new THREE.Mesh(pythonRingGeo, pythonRingMat)
  pythonRing.rotation.x = Math.PI / 2
  coreGroup.add(pythonRing)

  // TypeScript Blue Ring — TorusGeometry(1.2, 0.08, 32, 100), rotation.y=PI/2
  const tsRingGeo = new THREE.TorusGeometry(1.2, 0.08, 32, 100)
  const tsRingMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x3b82f6,
    emissiveIntensity: 2,
    toneMapped: false,
  })
  const tsRing = new THREE.Mesh(tsRingGeo, tsRingMat)
  tsRing.rotation.y = Math.PI / 2
  coreGroup.add(tsRing)

  // Inner Sphere — SphereGeometry(0.7, 32, 32)
  const innerSphereGeo = new THREE.SphereGeometry(0.7, 32, 32)
  const innerSphereMat = new THREE.MeshStandardMaterial({
    color: 0xddeeff,
    emissive: 0xddeeff,
    emissiveIntensity: 0.6,
    toneMapped: false,
  })
  const innerSphere = new THREE.Mesh(innerSphereGeo, innerSphereMat)
  coreGroup.add(innerSphere)

  // -----------------------------------------------------------------------
  // GlassShield (animated: rotation.y = elapsed*0.1, rotation.z = elapsed*0.05)
  // -----------------------------------------------------------------------
  const shieldGeo = new THREE.IcosahedronGeometry(2.4, 1)
  const shieldMat = new THREE.MeshPhysicalMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.03,
    roughness: 0.3,
    metalness: 0.1,
    envMapIntensity: 0.1,
    side: THREE.DoubleSide,
  })
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat)
  floatGroup.add(shieldMesh)

  // Edges on the shield — threshold=15, color=#3b82f6
  const edgesGeo = new THREE.EdgesGeometry(shieldGeo, 15)
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.12 })
  const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat)
  shieldMesh.add(edgesLine)

  // -----------------------------------------------------------------------
  // LightStream factory
  // -----------------------------------------------------------------------
  interface LightStreamParams {
    color: number
    speed: number
    offset: number
    radius: number
    height: number
    intensity: number
  }

  const lightStreamGroups: { group: THREE.Group; speed: number }[] = []

  function createLightStream(params: LightStreamParams): THREE.Group {
    const { color, speed, offset, radius, height, intensity } = params
    const group = new THREE.Group()

    // Build curve: 151 points (0..150)
    const curvePoints: THREE.Vector3[] = []
    for (let i = 0; i <= 150; i++) {
      const t = i / 150
      const angle = t * Math.PI * 6 + offset
      const x = Math.cos(angle) * radius * (1 + Math.sin(t * Math.PI) * 0.2)
      const y = (t - 0.5) * height
      const z = Math.sin(angle) * radius * (1 + Math.cos(t * Math.PI) * 0.2)
      curvePoints.push(new THREE.Vector3(x, y, z))
    }
    const curve = new THREE.CatmullRomCurve3(curvePoints)

    // Tube mesh — TubeGeometry(curve, 200, 0.03, 8, false)
    const tubeGeo = new THREE.TubeGeometry(curve, 200, 0.02, 8, false)
    const tubeMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      toneMapped: false,
      transparent: true,
      opacity: 0.6,
    })
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
    group.add(tubeMesh)

    // End spheres — small glowing caps at curve endpoints
    const endSphereGeo = new THREE.SphereGeometry(0.08, 16, 16)
    const endSphereMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity * 0.8,
      toneMapped: false,
    })

    const startSphere = new THREE.Mesh(endSphereGeo, endSphereMat)
    startSphere.position.copy(curve.getPoint(0))
    group.add(startSphere)

    const endSphere = new THREE.Mesh(endSphereGeo, endSphereMat.clone())
    endSphere.position.copy(curve.getPoint(1))
    group.add(endSphere)

    lightStreamGroups.push({ group, speed })
    return group
  }

  // Amber LightStream — compact spiral, subtle glow
  floatGroup.add(
    createLightStream({
      color: 0xf59e0b,
      speed: 0.6,
      offset: 0,
      radius: 3,
      height: 5,
      intensity: 1.8,
    }),
  )

  // Blue LightStream — compact spiral, subtle glow
  floatGroup.add(
    createLightStream({
      color: 0x3b82f6,
      speed: -0.7,
      offset: Math.PI,
      radius: 3.5,
      height: 5,
      intensity: 1.8,
    }),
  )

  // -----------------------------------------------------------------------
  // Sparkles (custom ShaderMaterial + Points)
  // -----------------------------------------------------------------------
  interface SparklesParams {
    count: number
    scale: number
    size: number
    speed: number
    opacity: number
    color: THREE.Color
  }

  const sparklesUniforms: THREE.IUniform<number>[] = []

  function createSparkles(params: SparklesParams): THREE.Points {
    const { count, scale, size, speed, opacity, color } = params

    // Random positions within scale cube, sizes randomized 0..size
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const offsets = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * scale
      positions[i * 3 + 1] = (Math.random() - 0.5) * scale
      positions[i * 3 + 2] = (Math.random() - 0.5) * scale
      sizes[i] = Math.random() * size
      offsets[i] = Math.random() * Math.PI * 2
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1))

    const uTime: THREE.IUniform<number> = { value: 0 }
    sparklesUniforms.push(uTime)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uColor: { value: color },
        uOpacity: { value: opacity },
        uSpeed: { value: speed },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aOffset;
        uniform float uTime;
        uniform float uSpeed;
        varying float vAlpha;

        void main() {
          float t = uTime * uSpeed + aOffset;
          vec3 pos = position;
          pos.x += sin(t * 1.1) * 0.3;
          pos.y += cos(t * 1.3) * 0.3;
          pos.z += sin(t * 0.7) * 0.3;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = aSize * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;

          vAlpha = 0.5 + 0.5 * sin(t * 2.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float strength = 1.0 - dist * 2.0;
          strength = pow(strength, 3.0);
          gl_FragColor = vec4(uColor, strength * uOpacity * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    return new THREE.Points(geometry, material)
  }

  // Blue sparkles — subtle background stars
  scene.add(
    createSparkles({
      count: 120,
      scale: 18,
      size: 1.5,
      speed: 0.15,
      opacity: 0.3,
      color: new THREE.Color(0x3b82f6),
    }),
  )

  // Amber sparkles — subtle background stars
  scene.add(
    createSparkles({
      count: 60,
      scale: 18,
      size: 2,
      speed: 0.3,
      opacity: 0.2,
      color: new THREE.Color(0xf59e0b),
    }),
  )

  // -----------------------------------------------------------------------
  // Animation loop
  // -----------------------------------------------------------------------
  let rafId: number | null = null

  function animate() {
    rafId = requestAnimationFrame(animate)
    const elapsed = clock.getElapsedTime()

    // Core rotation — slowed for elegance
    coreGroup.rotation.x = elapsed * 0.2
    coreGroup.rotation.y = elapsed * 0.15

    // GlassShield rotation
    shieldMesh.rotation.y = elapsed * 0.1
    shieldMesh.rotation.z = elapsed * 0.05

    // LightStream rotations
    for (const ls of lightStreamGroups) {
      ls.group.rotation.y = elapsed * ls.speed
    }

    // Float animation (replicates drei Float)
    const ft = floatOffset + elapsed
    floatGroup.rotation.x =
      (Math.cos((ft / 4) * floatSpeed) / 8) * floatRotationIntensity
    floatGroup.rotation.y =
      (Math.sin((ft / 4) * floatSpeed) / 8) * floatRotationIntensity
    floatGroup.rotation.z =
      (Math.sin((ft / 4) * floatSpeed) / 20) * floatRotationIntensity

    let yPos = Math.sin((ft / 4) * floatSpeed) / 10
    yPos = THREE.MathUtils.mapLinear(yPos, -0.1, 0.1, -0.1, 0.1)
    floatGroup.position.y = yPos * floatFloatIntensity

    // Sparkles time uniform
    for (const u of sparklesUniforms) {
      u.value = elapsed
    }

    // Render via composer (includes bloom)
    composer.render()
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  function start() {
    clock.start()
    animate()
  }

  function dispose() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    composer.dispose()
    renderer.dispose()

    // Traverse and dispose all geometries/materials/textures
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose())
        } else {
          mat.dispose()
        }
      }
      if (obj instanceof THREE.Points) {
        obj.geometry.dispose()
        ;(obj.material as THREE.ShaderMaterial).dispose()
      }
    })
  }

  function resize(w: number, h: number) {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }

  return { scene, camera, renderer, start, dispose, resize }
}
