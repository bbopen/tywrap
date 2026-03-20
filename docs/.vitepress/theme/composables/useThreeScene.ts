/**
 * useThreeScene — Vue composable that builds and animates the tywrap hero 3D scene.
 *
 * 1:1 port of the React Three Fiber scene from bbopen/tywrap-hero-visual.
 * All parameters match the original exactly.
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

// drei "city" preset HDR environment map
const CITY_HDR_URL =
  'https://raw.githubusercontent.com/pmndrs/drei-assets/master/hdri/city.hdr'

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
        pmremGenerator.dispose()
      },
    )
  })
}

export function useThreeScene(options: ThreeSceneOptions): ThreeSceneReturn {
  const { canvas, width, height } = options

  const scene = new THREE.Scene()
  const clock = new THREE.Clock()

  // Camera — fov=45, position=[0,0,12]
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
  camera.position.set(0, 0, 12)

  // Renderer — matches R3F Canvas defaults
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
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace

  // --- Lights ---

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2)
  scene.add(ambientLight)

  const pointLight1 = new THREE.PointLight(0xffffff, 1)
  pointLight1.position.set(10, 10, 10)
  scene.add(pointLight1)

  const pointLight2 = new THREE.PointLight(0x3b82f6, 2)
  pointLight2.position.set(-10, -10, -10)
  scene.add(pointLight2)

  // Environment map — drei "city" preset
  loadEnvironment(scene, renderer)

  // --- Post-processing ---

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  })
  composer.addPass(new RenderPass(scene, camera))

  const bloomEffect = new BloomEffect({
    luminanceThreshold: 1,
    mipmapBlur: true,
    intensity: 1.0,
  })
  composer.addPass(new EffectPass(camera, bloomEffect))

  // --- Float group ---
  // Replicates drei Float: speed=2, rotationIntensity=0.5, floatIntensity=0.5

  const floatGroup = new THREE.Group()
  scene.add(floatGroup)
  const floatOffset = Math.random() * 10000
  const FLOAT_SPEED = 2
  const FLOAT_ROT_INTENSITY = 0.5
  const FLOAT_INTENSITY = 0.5

  // --- Core group ---

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
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1,
    toneMapped: false,
  })
  const innerSphere = new THREE.Mesh(innerSphereGeo, innerSphereMat)
  coreGroup.add(innerSphere)

  // --- GlassShield ---

  const shieldGeo = new THREE.IcosahedronGeometry(2.4, 1)
  const shieldMat = new THREE.MeshPhysicalMaterial({
    transmission: 1,
    roughness: 0.05,
    thickness: 2,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0.8,
  })
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat)
  floatGroup.add(shieldMesh)

  // Edges — threshold=15, color=#3b82f6
  const edgesGeo = new THREE.EdgesGeometry(shieldGeo, 15)
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x3b82f6 })
  const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat)
  shieldMesh.add(edgesLine)

  // --- LightStream factory ---

  const lightStreamGroups: { group: THREE.Group; speed: number }[] = []

  function createLightStream(
    color: number,
    speed: number,
    offset: number,
    radius: number,
    height: number,
    intensity: number,
  ): THREE.Group {
    const group = new THREE.Group()

    // Curve: 151 points
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

    // Tube — (curve, 200, 0.03, 8, false)
    const tubeGeo = new THREE.TubeGeometry(curve, 200, 0.03, 8, false)
    const tubeMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      toneMapped: false,
      transparent: true,
      opacity: 0.8,
    })
    group.add(new THREE.Mesh(tubeGeo, tubeMat))

    // End spheres — SphereGeometry(0.12, 16, 16), emissiveIntensity=intensity*2
    const endSphereGeo = new THREE.SphereGeometry(0.12, 16, 16)
    const endSphereMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity * 2,
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

  // Amber Python Stream — exact original params
  floatGroup.add(createLightStream(0xf59e0b, 0.8, 0, 3.5, 8, 5))

  // Sapphire TypeScript Stream — exact original params
  floatGroup.add(createLightStream(0x3b82f6, -1, Math.PI, 4, 8, 5))

  // --- Sparkles ---

  const sparklesUniforms: THREE.IUniform<number>[] = []

  function createSparkles(
    count: number,
    scale: number,
    size: number,
    speed: number,
    opacity: number,
    color: THREE.Color,
  ): THREE.Points {
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

  // Blue sparkles — count=200, scale=15, size=2, speed=0.2, opacity=0.5
  scene.add(createSparkles(200, 15, 2, 0.2, 0.5, new THREE.Color(0x3b82f6)))

  // Amber sparkles — count=100, scale=15, size=3, speed=0.4, opacity=0.3
  scene.add(createSparkles(100, 15, 3, 0.4, 0.3, new THREE.Color(0xf59e0b)))

  // --- Animation loop ---

  let rafId: number | null = null

  function animate() {
    rafId = requestAnimationFrame(animate)
    const elapsed = clock.getElapsedTime()

    // Core rotation — x*0.4, y*0.3
    coreGroup.rotation.x = elapsed * 0.4
    coreGroup.rotation.y = elapsed * 0.3

    // GlassShield rotation — y*0.1, z*0.05
    shieldMesh.rotation.y = elapsed * 0.1
    shieldMesh.rotation.z = elapsed * 0.05

    // LightStream rotations
    for (const ls of lightStreamGroups) {
      ls.group.rotation.y = elapsed * ls.speed
    }

    // Float animation — drei Float exact math
    const ft = floatOffset + elapsed
    floatGroup.rotation.x =
      (Math.cos((ft / 4) * FLOAT_SPEED) / 8) * FLOAT_ROT_INTENSITY
    floatGroup.rotation.y =
      (Math.sin((ft / 4) * FLOAT_SPEED) / 8) * FLOAT_ROT_INTENSITY
    floatGroup.rotation.z =
      (Math.sin((ft / 4) * FLOAT_SPEED) / 20) * FLOAT_ROT_INTENSITY

    let yPos = Math.sin((ft / 4) * FLOAT_SPEED) / 10
    yPos = THREE.MathUtils.mapLinear(yPos, -0.1, 0.1, -0.1, 0.1)
    floatGroup.position.y = yPos * FLOAT_INTENSITY

    // Sparkles time
    for (const u of sparklesUniforms) {
      u.value = elapsed
    }

    // Pre-render to update transmission render targets (MeshPhysicalMaterial
    // with transmission needs a normal render pass to capture the background).
    // Without this, the glass shield renders as an opaque gray blob.
    renderer.render(scene, camera)

    // Then render through composer for bloom post-processing
    composer.render()
  }

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
