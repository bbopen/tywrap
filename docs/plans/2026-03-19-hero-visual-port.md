# Hero Visual Port Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the React Three Fiber 3D hero visual from `bbopen/tywrap-hero-visual` to a Vue 3 component for the VitePress docs site, achieving 1:1 visual parity.

**Architecture:** Raw Three.js in a Vue composable (`useThreeScene.ts`) mounted into a `Hero3D.vue` component. The component replaces VitePress's default hero entirely via the `layout-top` slot. CSS `@keyframes` animations replace Framer Motion. A codecert patch equivalence verification confirms parameter-level fidelity against the React source.

**Tech Stack:** Three.js, postprocessing (vanilla), Vue 3 Composition API, VitePress custom theme, CSS animations

**Source repo:** Clone `bbopen/tywrap-hero-visual` to `/tmp/tywrap-hero-visual` first:
```bash
gh auth switch --user bbopen 2>/dev/null; gh repo clone bbopen/tywrap-hero-visual /tmp/tywrap-hero-visual
```

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install three and postprocessing**

```bash
npm install three postprocessing
npm install -D @types/three
```

**Step 2: Verify installation**

```bash
node -e "require('three'); require('postprocessing'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add three.js and postprocessing dependencies for hero visual"
```

---

### Task 2: Create Three.js Scene Composable — Base Setup

**Files:**
- Create: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Write the base composable**

This sets up renderer, camera, scene, lights, and the animation loop. No geometries yet.

```typescript
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  AmbientLight,
  PointLight,
  Color,
  Clock,
  HalfFloatType,
} from 'three'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
} from 'postprocessing'

export interface ThreeSceneOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

export function useThreeScene({ canvas, width, height }: ThreeSceneOptions) {
  const clock = new Clock()
  const scene = new Scene()

  // Camera — PerspectiveCamera(fov 45, pos [0,0,12])
  const camera = new PerspectiveCamera(45, width / height, 0.1, 100)
  camera.position.set(0, 0, 12)

  // Renderer — alpha true, antialias false, dpr [1,2]
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)

  // Lights
  // AmbientLight(intensity 0.2)
  const ambient = new AmbientLight(0xffffff, 0.2)
  scene.add(ambient)

  // PointLight(pos [10,10,10], intensity 1)
  const pointLight1 = new PointLight(0xffffff, 1)
  pointLight1.position.set(10, 10, 10)
  scene.add(pointLight1)

  // PointLight(pos [-10,-10,-10], color #3b82f6, intensity 2)
  const pointLight2 = new PointLight(new Color('#3b82f6'), 2)
  pointLight2.position.set(-10, -10, -10)
  scene.add(pointLight2)

  // Post-processing — Bloom(luminanceThreshold 1, mipmapBlur true, intensity 1.0)
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
  })
  composer.addPass(new RenderPass(scene, camera))

  const bloomEffect = new BloomEffect({
    luminanceThreshold: 1,
    mipmapBlur: true,
    intensity: 1.0,
  })
  composer.addPass(new EffectPass(camera, bloomEffect))

  let animationId: number | null = null

  function animate() {
    animationId = requestAnimationFrame(animate)
    const elapsed = clock.getElapsedTime()
    // (scene objects will hook into this elapsed time)
    updateScene(elapsed)
    composer.render()
  }

  // Placeholder — filled in by subsequent tasks
  function updateScene(_elapsed: number) {}

  function resize(w: number, h: number) {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }

  function start() {
    clock.start()
    animate()
  }

  function dispose() {
    if (animationId !== null) cancelAnimationFrame(animationId)
    composer.dispose()
    renderer.dispose()
  }

  return { scene, camera, renderer, start, dispose, resize }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project docs/.vitepress/tsconfig.json 2>/dev/null || npx vue-tsc --noEmit 2>/dev/null || echo "Check manually"
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add Three.js scene composable — base setup with camera, lights, bloom"
```

---

### Task 3: Add Core Group (Torus Rings + Sphere)

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Add Core group**

Add these imports and the Core group creation after the lights section:

```typescript
import {
  // ...existing imports plus:
  Group,
  Mesh,
  TorusGeometry,
  SphereGeometry,
  MeshStandardMaterial,
} from 'three'
```

Add after lights:

```typescript
  // === Core group (rotation x*0.4, y*0.3) ===
  const coreGroup = new Group()

  // Python Yellow Ring — Torus(r=1.2, tube=0.08, radialSeg=32, tubularSeg=100), rot [π/2,0,0]
  const pythonRingGeo = new TorusGeometry(1.2, 0.08, 32, 100)
  const pythonRingMat = new MeshStandardMaterial({
    color: new Color('#f59e0b'),
    emissive: new Color('#f59e0b'),
    emissiveIntensity: 2,
    toneMapped: false,
  })
  const pythonRing = new Mesh(pythonRingGeo, pythonRingMat)
  pythonRing.rotation.x = Math.PI / 2
  coreGroup.add(pythonRing)

  // TypeScript Blue Ring — Torus(r=1.2, tube=0.08, radialSeg=32, tubularSeg=100), rot [0,π/2,0]
  const tsRingGeo = new TorusGeometry(1.2, 0.08, 32, 100)
  const tsRingMat = new MeshStandardMaterial({
    color: new Color('#3b82f6'),
    emissive: new Color('#3b82f6'),
    emissiveIntensity: 2,
    toneMapped: false,
  })
  const tsRing = new Mesh(tsRingGeo, tsRingMat)
  tsRing.rotation.y = Math.PI / 2
  coreGroup.add(tsRing)

  // Inner glowing energy — Sphere(r=0.7, widthSeg=32, heightSeg=32)
  const innerSphereGeo = new SphereGeometry(0.7, 32, 32)
  const innerSphereMat = new MeshStandardMaterial({
    color: new Color('#ffffff'),
    emissive: new Color('#ffffff'),
    emissiveIntensity: 1,
    toneMapped: false,
  })
  const innerSphere = new Mesh(innerSphereGeo, innerSphereMat)
  coreGroup.add(innerSphere)

  scene.add(coreGroup)
```

Update `updateScene`:

```typescript
  function updateScene(elapsed: number) {
    // Core rotation — x*0.4, y*0.3
    coreGroup.rotation.x = elapsed * 0.4
    coreGroup.rotation.y = elapsed * 0.3
  }
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```
Expected: `build complete`

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add Core group — Python/TS torus rings and inner glow sphere"
```

---

### Task 4: Add GlassShield (Icosahedron + Edges)

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Add GlassShield**

Add imports:

```typescript
import {
  // ...plus:
  IcosahedronGeometry,
  MeshPhysicalMaterial,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
} from 'three'
```

Add after Core group, before `scene.add(coreGroup)`:

```typescript
  // === GlassShield — Icosahedron(r=2.4, detail=1) ===
  const shieldGeo = new IcosahedronGeometry(2.4, 1)
  const shieldMat = new MeshPhysicalMaterial({
    transmission: 1,
    roughness: 0.05,
    thickness: 2,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    color: new Color('#e0f2fe'),
    transparent: true,
    opacity: 0.8,
  })
  const shield = new Mesh(shieldGeo, shieldMat)

  // Edges — threshold 15, color #3b82f6
  const edgesGeo = new EdgesGeometry(shieldGeo, 15)
  const edgesMat = new LineBasicMaterial({ color: new Color('#3b82f6') })
  const edges = new LineSegments(edgesGeo, edgesMat)
  shield.add(edges)

  scene.add(shield)
```

Update `updateScene` to add shield rotation:

```typescript
  function updateScene(elapsed: number) {
    // Core rotation
    coreGroup.rotation.x = elapsed * 0.4
    coreGroup.rotation.y = elapsed * 0.3

    // GlassShield rotation — y*0.1, z*0.05
    shield.rotation.y = elapsed * 0.1
    shield.rotation.z = elapsed * 0.05
  }
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add GlassShield — icosahedron with edges"
```

---

### Task 5: Add LightStream Curves

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Add LightStream factory**

Add imports:

```typescript
import {
  // ...plus:
  Vector3,
  CatmullRomCurve3,
  TubeGeometry,
} from 'three'
```

Add a factory function inside `useThreeScene`, before the scene assembly:

```typescript
  // === LightStream factory ===
  function createLightStream(
    color: string,
    speed: number,
    offset: number,
    radius: number,
    height: number,
    intensity: number,
  ): Group {
    const group = new Group()

    // Generate curve — 150 points, 6π turns, sinusoidal wobble
    const curvePoints: Vector3[] = []
    for (let i = 0; i <= 150; i++) {
      const t = i / 150
      const angle = t * Math.PI * 6 + offset
      const x = Math.cos(angle) * radius * (1 + Math.sin(t * Math.PI) * 0.2)
      const y = (t - 0.5) * height
      const z = Math.sin(angle) * radius * (1 + Math.cos(t * Math.PI) * 0.2)
      curvePoints.push(new Vector3(x, y, z))
    }
    const curve = new CatmullRomCurve3(curvePoints)

    // Tube — segments=200, radius=0.03, radialSegments=8
    const tubeGeo = new TubeGeometry(curve, 200, 0.03, 8, false)
    const tubeMat = new MeshStandardMaterial({
      color: new Color(color),
      emissive: new Color(color),
      emissiveIntensity: intensity,
      toneMapped: false,
      transparent: true,
      opacity: 0.8,
    })
    group.add(new Mesh(tubeGeo, tubeMat))

    // End spheres — Sphere(r=0.12, 16, 16) at curve start and end
    const sphereGeo = new SphereGeometry(0.12, 16, 16)
    const sphereMat = new MeshStandardMaterial({
      color: new Color(color),
      emissive: new Color(color),
      emissiveIntensity: intensity * 2,
      toneMapped: false,
    })

    const startPos = curve.getPoint(0)
    const startSphere = new Mesh(sphereGeo, sphereMat)
    startSphere.position.copy(startPos)
    group.add(startSphere)

    const endPos = curve.getPoint(1)
    const endSphere = new Mesh(sphereGeo.clone(), sphereMat.clone())
    endSphere.position.copy(endPos)
    group.add(endSphere)

    // Store speed for animation
    group.userData.speed = speed
    return group
  }

  // Amber Python Stream — color=#f59e0b, speed=0.8, offset=0, radius=3.5, height=8, intensity=5
  const amberStream = createLightStream('#f59e0b', 0.8, 0, 3.5, 8, 5)
  scene.add(amberStream)

  // Sapphire TypeScript Stream — color=#3b82f6, speed=-1, offset=π, radius=4, height=8, intensity=5
  const blueStream = createLightStream('#3b82f6', -1, Math.PI, 4, 8, 5)
  scene.add(blueStream)
```

Update `updateScene`:

```typescript
  function updateScene(elapsed: number) {
    coreGroup.rotation.x = elapsed * 0.4
    coreGroup.rotation.y = elapsed * 0.3

    shield.rotation.y = elapsed * 0.1
    shield.rotation.z = elapsed * 0.05

    // LightStream rotation — each rotates on Y at its own speed
    amberStream.rotation.y = elapsed * amberStream.userData.speed
    blueStream.rotation.y = elapsed * blueStream.userData.speed
  }
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add LightStream spiraling curves — amber and blue"
```

---

### Task 6: Add Float Animation

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Implement Float logic**

The Float animation from `@react-three/drei` applies sinusoidal rotation and Y-position offsets. We replicate the exact math.

Wrap Core, Shield, and LightStreams in a parent group. Add a random offset for organic feel.

Add after creating all scene objects, before `scene.add` calls:

```typescript
import { MathUtils } from 'three'

  // === Float group ===
  // Replicates @react-three/drei Float with speed=2, rotationIntensity=0.5, floatIntensity=0.5
  const floatGroup = new Group()
  const floatOffset = Math.random() * 10000
  const floatSpeed = 2
  const floatRotationIntensity = 0.5
  const floatIntensity = 0.5
  const floatRange: [number, number] = [-0.1, 0.1]

  floatGroup.add(coreGroup)
  floatGroup.add(shield)
  floatGroup.add(amberStream)
  floatGroup.add(blueStream)
  scene.add(floatGroup)
```

Remove the individual `scene.add` calls for coreGroup, shield, amberStream, blueStream and replace with the floatGroup.

Update `updateScene` to add Float math:

```typescript
  function updateScene(elapsed: number) {
    // Float animation — drei Float exact math
    const t = floatOffset + elapsed
    floatGroup.rotation.x = (Math.cos((t / 4) * floatSpeed) / 8) * floatRotationIntensity
    floatGroup.rotation.y = (Math.sin((t / 4) * floatSpeed) / 8) * floatRotationIntensity
    floatGroup.rotation.z = (Math.sin((t / 4) * floatSpeed) / 20) * floatRotationIntensity
    let yPos = Math.sin((t / 4) * floatSpeed) / 10
    yPos = MathUtils.mapLinear(yPos, -0.1, 0.1, floatRange[0], floatRange[1])
    floatGroup.position.y = yPos * floatIntensity

    // Core rotation (relative to float group)
    coreGroup.rotation.x = elapsed * 0.4
    coreGroup.rotation.y = elapsed * 0.3

    // GlassShield rotation
    shield.rotation.y = elapsed * 0.1
    shield.rotation.z = elapsed * 0.05

    // LightStream rotation
    amberStream.rotation.y = elapsed * amberStream.userData.speed
    blueStream.rotation.y = elapsed * blueStream.userData.speed
  }
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add Float animation — drei-equivalent sinusoidal bob and rotation"
```

---

### Task 7: Add Sparkles (Custom Shader Particles)

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Implement Sparkles**

Replicates `@react-three/drei` Sparkles using `THREE.Points` with custom `ShaderMaterial`.

Add imports:

```typescript
import {
  // ...plus:
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  Points,
  AdditiveBlending,
} from 'three'
```

Add a factory function:

```typescript
  // === Sparkles factory ===
  // Replicates @react-three/drei Sparkles
  function createSparkles(
    count: number,
    scale: number,
    size: number,
    speed: number,
    opacity: number,
    color: string,
  ): Points {
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const speeds = new Float32Array(count)
    const opacities = new Float32Array(count)
    const noises = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * scale
      positions[i * 3 + 1] = (Math.random() - 0.5) * scale
      positions[i * 3 + 2] = (Math.random() - 0.5) * scale
      sizes[i] = Math.random() * size
      speeds[i] = speed + Math.random() * speed
      opacities[i] = opacity
      noises[i * 3] = (Math.random() - 0.5) * 4
      noises[i * 3 + 1] = (Math.random() - 0.5) * 4
      noises[i * 3 + 2] = (Math.random() - 0.5) * 4
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
    geometry.setAttribute('aSpeed', new Float32BufferAttribute(speeds, 1))
    geometry.setAttribute('aOpacity', new Float32BufferAttribute(opacities, 1))
    geometry.setAttribute('aNoise', new Float32BufferAttribute(noises, 3))

    const c = new Color(color)

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: c },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aSpeed;
        attribute float aOpacity;
        attribute vec3 aNoise;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vOpacity;
        void main() {
          vec3 pos = position;
          pos += sin(uTime * aSpeed + aNoise) * 0.5;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vOpacity = aOpacity;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vOpacity;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float strength = 1.0 - (d * 2.0);
          strength = pow(strength, 3.0);
          gl_FragColor = vec4(uColor, strength * vOpacity);
        }
      `,
    })

    const points = new Points(geometry, material)
    return points
  }

  // Blue sparkles — count=200, scale=15, size=2, speed=0.2, opacity=0.5, color=#3b82f6
  const blueSparkles = createSparkles(200, 15, 2, 0.2, 0.5, '#3b82f6')
  scene.add(blueSparkles)

  // Amber sparkles — count=100, scale=15, size=3, speed=0.4, opacity=0.3, color=#f59e0b
  const amberSparkles = createSparkles(100, 15, 3, 0.4, 0.3, '#f59e0b')
  scene.add(amberSparkles)
```

Update `updateScene` to tick sparkle time uniforms:

```typescript
    // Sparkles time update
    ;(blueSparkles.material as ShaderMaterial).uniforms.uTime.value = elapsed
    ;(amberSparkles.material as ShaderMaterial).uniforms.uTime.value = elapsed
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add Sparkles — custom shader particles for blue and amber"
```

---

### Task 8: Add Environment Map

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Add environment map loading**

The React source uses `<Environment preset="city" />` from drei. This loads an HDR environment map. For the vanilla port, we use `THREE.PMREMGenerator` with a simple ambient approximation, or load the same HDR. Since we don't want to bundle a large HDR file for a docs site, we approximate the "city" environment with scene lighting that produces the same reflections on the glass shield.

Add after existing lights:

```typescript
import { PMREMGenerator, CubeTextureLoader } from 'three'

  // Environment approximation — replicate "city" preset lighting on glass shield
  // The city preset provides subtle warm/cool reflections. We approximate with
  // additional directional fill lights matching the preset's character.
  const fillLight1 = new PointLight(new Color('#ffeedd'), 0.5)
  fillLight1.position.set(5, 5, -5)
  scene.add(fillLight1)

  const fillLight2 = new PointLight(new Color('#ddeeff'), 0.3)
  fillLight2.position.set(-5, -3, 5)
  scene.add(fillLight2)
```

Note: If exact HDR parity is needed later, the `city` preset HDR can be downloaded from drei's CDN and loaded with `RGBELoader`. This approximation captures the visual character without the ~2MB HDR download.

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): add environment lighting — city preset approximation"
```

---

### Task 9: Expose Scene Update and Return Complete API

**Files:**
- Modify: `docs/.vitepress/theme/composables/useThreeScene.ts`

**Step 1: Consolidate the composable**

Ensure the `updateScene` function is fully wired and the composable returns everything needed. The final `useThreeScene` function should have all scene objects created inline (Tasks 3-8) and the `updateScene` function containing all animation logic. Remove the placeholder `updateScene` and ensure the real one is in place.

Return type:

```typescript
  return { scene, camera, renderer, composer, start, dispose, resize }
```

**Step 2: Full file review**

Read through the entire composable file to ensure:
- All imports are at the top
- No duplicate variables
- `updateScene` has all animation ticks
- `dispose` cleans up all geometries and materials

**Step 3: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add docs/.vitepress/theme/composables/useThreeScene.ts
git commit -m "feat(docs): consolidate Three.js scene composable — complete scene graph"
```

---

### Task 10: Create Hero3D.vue — Full Hero Replacement

**Files:**
- Modify: `docs/.vitepress/theme/components/Hero3D.vue`

**Step 1: Write the complete Hero3D component**

This replaces the placeholder scaffold. It contains:
- The Three.js canvas (full-screen background)
- Radial gradient overlay
- Animated headline with gradient text
- Subheadline
- Two CTA buttons
- Floating code snippet decorations
- CSS entrance animations (replacing Framer Motion)

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useData } from 'vitepress'
import { useThreeScene } from '../composables/useThreeScene'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
let sceneApi: ReturnType<typeof useThreeScene> | null = null

const { site } = useData()

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return

  const { width, height } = containerRef.value.getBoundingClientRect()
  sceneApi = useThreeScene({
    canvas: canvasRef.value,
    width,
    height,
  })
  sceneApi.start()

  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  sceneApi?.dispose()
  window.removeEventListener('resize', handleResize)
})

function handleResize() {
  if (!containerRef.value || !sceneApi) return
  const { width, height } = containerRef.value.getBoundingClientRect()
  sceneApi.resize(width, height)
}
</script>

<template>
  <section ref="containerRef" class="hero-section">
    <!-- Three.js Canvas — absolute background -->
    <canvas ref="canvasRef" class="hero-canvas" />

    <!-- Dark gradient overlay for text contrast -->
    <div class="hero-overlay" />

    <!-- Content -->
    <div class="hero-content">
      <h1 class="hero-title anim-fade-up">
        Wrap Python in <br />
        <span class="hero-title-gradient">TypeScript Safety</span>
      </h1>

      <p class="hero-subtitle anim-fade-up anim-delay-1">
        The ultimate bridge for secure and efficient cross-language development.
        Seamlessly integrate and protect your Python assets with TypeScript's robust type system.
      </p>

      <div class="hero-actions anim-fade-up anim-delay-2">
        <a :href="site.base + 'guide/getting-started'" class="hero-btn-primary">
          Explore the Code Weaver
        </a>
        <a :href="site.base + 'reference/api/'" class="hero-btn-secondary">
          View Documentation
        </a>
      </div>
    </div>

    <!-- Floating Code Snippets (desktop only) -->
    <div class="hero-snippet hero-snippet-python">
      <div class="snippet-label">
        <span class="snippet-icon snippet-icon-python">Py</span>
        python
      </div>
      <pre class="snippet-code snippet-code-python">def py_func():
  import ts_mod
  return ts_mod.call()</pre>
    </div>

    <div class="hero-snippet hero-snippet-typescript">
      <div class="snippet-label">
        <span class="snippet-icon snippet-icon-typescript">Ts</span>
        typescript
      </div>
      <pre class="snippet-code snippet-code-typescript">interface ts_mod {
  call(): string;
}</pre>
    </div>

    <div class="hero-float-label hero-float-python">python -&gt;</div>
    <div class="hero-float-label hero-float-typescript">&lt;- ts_mod</div>
  </section>
</template>

<style scoped>
.hero-section {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 5rem;
  overflow: hidden;
  background-color: #0a0c10;
}

.hero-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  width: 100%;
  height: 100%;
}

.hero-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(0, 0, 0, 0.4) 0%, transparent 60%);
  z-index: 0;
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 10;
  max-width: 56rem;
  padding: 0 1.5rem;
  text-align: center;
  margin-top: 16rem;
}

.hero-title {
  font-size: clamp(2.5rem, 5vw, 4.5rem);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.1;
  margin-bottom: 1.5rem;
  color: #ffffff;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.hero-title-gradient {
  background: linear-gradient(to right, #60a5fa, #fbbf24);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 15px rgba(255, 255, 255, 0.3));
}

.hero-subtitle {
  font-size: clamp(1rem, 2vw, 1.25rem);
  color: #d1d5db;
  margin-bottom: 2.5rem;
  max-width: 42rem;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.6;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  font-weight: 500;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

@media (min-width: 640px) {
  .hero-actions {
    flex-direction: row;
  }
}

.hero-btn-primary {
  display: inline-block;
  width: 100%;
  max-width: 20rem;
  padding: 1rem 2rem;
  background-color: #f4b459;
  color: #000000;
  font-weight: 700;
  border-radius: 9999px;
  text-decoration: none;
  transition: all 0.2s;
  box-shadow: 0 10px 25px rgba(245, 158, 11, 0.2);
}

.hero-btn-primary:hover {
  background-color: #e5a348;
  transform: scale(1.05);
}

.hero-btn-primary:active {
  transform: scale(0.95);
}

.hero-btn-secondary {
  display: inline-block;
  width: 100%;
  max-width: 20rem;
  padding: 1rem 2rem;
  background-color: transparent;
  color: #ffffff;
  font-weight: 700;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  text-decoration: none;
  transition: all 0.2s;
}

.hero-btn-secondary:hover {
  background-color: rgba(255, 255, 255, 0.05);
  transform: scale(1.05);
}

.hero-btn-secondary:active {
  transform: scale(0.95);
}

/* Floating code snippets — desktop only */
.hero-snippet {
  position: absolute;
  opacity: 0.4;
  pointer-events: none;
  animation: pulse 2s ease-in-out infinite;
}

.hero-snippet-python {
  top: 20%;
  left: 15%;
}

.hero-snippet-typescript {
  top: 25%;
  right: 15%;
}

@media (max-width: 1024px) {
  .hero-snippet {
    display: none;
  }
}

.snippet-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1.125rem;
}

.snippet-icon {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}

.snippet-icon-python {
  background-color: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.snippet-label:has(.snippet-icon-python) {
  color: #f59e0b;
}

.snippet-icon-typescript {
  background-color: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.snippet-label:has(.snippet-icon-typescript) {
  color: #3b82f6;
}

.snippet-code {
  font-family: monospace;
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

.snippet-code-python {
  color: rgba(251, 191, 36, 0.6);
}

.snippet-code-typescript {
  color: rgba(96, 165, 250, 0.6);
}

/* Floating labels */
.hero-float-label {
  position: absolute;
  font-family: monospace;
  font-size: 0.875rem;
  opacity: 0.2;
  pointer-events: none;
}

.hero-float-python {
  bottom: 30%;
  left: 20%;
  color: #f59e0b;
}

.hero-float-typescript {
  bottom: 35%;
  right: 20%;
  color: #3b82f6;
}

@media (max-width: 1024px) {
  .hero-float-label {
    display: none;
  }
}

/* CSS entrance animations (replacing Framer Motion) */
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.6; }
}

.anim-fade-up {
  animation: fadeUp 0.8s ease-out forwards;
  opacity: 0;
}

.anim-delay-1 {
  animation-delay: 0.2s;
}

.anim-delay-2 {
  animation-delay: 0.4s;
}
</style>
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/.vitepress/theme/components/Hero3D.vue
git commit -m "feat(docs): implement Hero3D.vue — full hero replacement with Three.js canvas and overlay"
```

---

### Task 11: Update Theme Index and CSS

**Files:**
- Modify: `docs/.vitepress/theme/index.ts`
- Modify: `docs/.vitepress/theme/custom.css`

**Step 1: Update theme index**

The hero should only render on the home page. Use `useRoute` to conditionally show it.

```typescript
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import { useRoute } from 'vitepress'
import Hero3D from './components/Hero3D.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    const route = useRoute()
    const isHome = route.path === '/' || route.path === '/tywrap/'
    return h(DefaultTheme.Layout, null, {
      ...(isHome ? { 'layout-top': () => h(Hero3D) } : {}),
    })
  },
} satisfies Theme
```

**Step 2: Update custom.css**

Hide the default VitePress hero on the home page since our Hero3D replaces it:

```css
/* Custom theme overrides for tywrap docs */

/* Hide VitePress default hero — replaced by Hero3D component */
.VPHome > .VPHero {
  display: none;
}

/* Ensure home page has dark background for the hero */
.VPHome {
  background-color: #0a0c10;
}

/* Features section inherits dark theme on home */
.VPHome .VPFeatures {
  background-color: #0a0c10;
}
```

**Step 3: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 4: Verify dev server renders correctly**

```bash
npm run docs:dev &
sleep 3
echo "Open http://localhost:5173/tywrap/ to verify hero renders"
kill %1 2>/dev/null
```

**Step 5: Commit**

```bash
git add docs/.vitepress/theme/index.ts docs/.vitepress/theme/custom.css
git commit -m "feat(docs): wire Hero3D into theme — layout-top slot, hide default hero"
```

---

### Task 12: Update docs/index.md Frontmatter

**Files:**
- Modify: `docs/index.md`

**Step 1: Keep the features section but note the hero is custom**

The `hero:` frontmatter can remain (it won't render since we hide `.VPHero`), but we should keep `features:` since those render below the hero via VitePress's built-in features grid. No changes needed to `index.md` unless we want to clean it up.

Actually — the `layout: home` must stay, and the `features:` block must stay. The `hero:` block is now dead code since it's hidden. Remove it for cleanliness:

```markdown
---
layout: home

features:
  - icon: 🔒
    title: Full Type Safety
    details: TypeScript definitions generated directly from Python source analysis via AST — no manual type writing.
  - icon: 🌐
    title: Multi-Runtime
    details: One API across Node.js, Bun, Deno (subprocess), and browsers (Pyodide WebAssembly).
  - icon: ⚡
    title: Rich Data Types
    details: First-class support for numpy, pandas, scipy, torch, and sklearn with Apache Arrow binary transport.
  - icon: 🛠
    title: Zero-Config CLI
    details: Run `npx tywrap generate` and get production-ready TypeScript wrappers with a single command.
---

## Quick Start

```bash
npm install tywrap
pip install tywrap-ir
npx tywrap init
npx tywrap generate
```

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

setRuntimeBridge(new NodeBridge({ pythonPath: 'python3' }));
const result = await math.sqrt(16); // 4 — fully typed
```

> ⚠️ **Experimental** — APIs may change before v1.0.0. See [Releases](https://github.com/bbopen/tywrap/releases) for breaking changes.

> If tywrap saves you time, a ⭐ on [GitHub](https://github.com/bbopen/tywrap) helps others find it.
```

**Step 2: Verify build**

```bash
npm run docs:build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add docs/index.md
git commit -m "docs: remove dead hero frontmatter — now handled by Hero3D component"
```

---

### Task 13: codecert Patch Equivalence Verification

**Files:**
- Read: `/tmp/tywrap-hero-visual/src/components/ThreeScene.tsx` (React source)
- Read: `/tmp/tywrap-hero-visual/src/components/Hero.tsx` (React source)
- Read: `/tmp/tywrap-hero-visual/src/index.css` (React source)
- Read: `docs/.vitepress/theme/composables/useThreeScene.ts` (Vue port)
- Read: `docs/.vitepress/theme/components/Hero3D.vue` (Vue port)
- Read: `docs/.vitepress/theme/custom.css` (Vue port)

**Step 1: Invoke codecert skill**

Use the `codecert` skill with mode "patch equivalence" to produce a formal verification certificate. The certificate must:

1. Extract a structured manifest from the React source: every geometry constructor + args, every material type + properties, every light type + position + intensity + color, camera config, animation formulas, curve math, post-processing config
2. Extract the same manifest from the Vue port
3. Compare parameter-by-parameter with evidence traces
4. Flag any deviations
5. Produce formal EQUIVALENT / NOT EQUIVALENT conclusion

**Step 2: Fix any deviations found**

If codecert finds parameter mismatches, fix them in the Vue port files and re-run verification.

**Step 3: Commit certificate**

```bash
git add docs/plans/2026-03-19-hero-visual-port-codecert.md
git commit -m "docs: add codecert patch equivalence certificate for hero visual port"
```

---

### Task 14: Final Build and Visual Smoke Test

**Files:** None (verification only)

**Step 1: Full build**

```bash
npm run docs:build 2>&1 | tail -10
```
Expected: `build complete`

**Step 2: Run main test suite to check no regressions**

```bash
npm test 2>&1 | tail -10
```
Expected: All tests pass

**Step 3: Visual smoke test**

```bash
npx vitepress preview docs --port 4173 &
sleep 2
echo "Open http://localhost:4173/tywrap/ — verify:"
echo "  1. 3D scene renders (torus rings, glass shield, light streams, sparkles)"
echo "  2. Floating code snippets visible on desktop"
echo "  3. Headline with gradient text"
echo "  4. Both CTA buttons link correctly"
echo "  5. Features grid renders below hero"
echo "  6. Entrance animations play on load"
kill %1 2>/dev/null
```

**Step 4: Commit all remaining changes**

```bash
git add -A
git status
# If any uncommitted changes remain, commit them
git commit -m "feat(docs): complete hero visual port — 1:1 from tywrap-hero-visual"
```

---

Plan complete and saved to `docs/plans/2026-03-19-hero-visual-port.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints

Which approach?