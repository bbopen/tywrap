/**
 * useThreeScene — Vue composable that builds and animates the tywrap hero 3D scene.
 *
 * Reimagined with a high-end, cinematic procedural particle network
 * inspired by the "Hermes 4" glowing graph aesthetic representing
 * Python-to-TypeScript data flow.
 */

import * as THREE from 'three'
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
  dispose: () => void
  resize: (w: number, h: number) => void
  onScroll: (scrollY: number) => void
}

// ---------------------------------------------------------------------------
// Simplex Noise 3D GLSL
// ---------------------------------------------------------------------------
const snoise3D = `
// GLSL textureless classic 3D noise "cnoise",
// with an RSL-style periodic variant "pnoise".
// Author:  Stefan Gustavson (stefan.gustavson@liu.se)
// Version: 2011-08-22
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){ 
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0 ); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
}
`

const particlesVertexShader = `
uniform float uTime;
uniform float uScrollCurrent;

attribute float aSize;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

${snoise3D}

void main() {
  vColor = aColor;
  vec3 pos = position;

  // Fluid curling motion using fbm
  float noise1 = snoise(vec3(pos.x * 0.2, pos.y * 0.2, uTime * 0.2));
  float noise2 = snoise(vec3(pos.y * 0.2, pos.z * 0.2, uTime * 0.25));
  float noise3 = snoise(vec3(pos.z * 0.2, pos.x * 0.2, uTime * 0.3));

  // The core pulses and shifts organically
  pos.x += noise1 * 2.0;
  pos.y += noise2 * 2.0;
  pos.z += noise3 * 2.0;
  
  // Parallax / Scroll effect: pull the cloud up as we scroll down
  pos.y += uScrollCurrent * 0.005;

  vec4 viewPosition = viewMatrix * modelMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  // Massively increase point size for visibility and glow
  gl_PointSize = aSize * (800.0 / -viewPosition.z);

  // Twinkling organic pulse
  vAlpha = 0.5 + 0.5 * snoise(vec3(pos.x * 0.5, pos.y * 0.5, uTime * 1.5));
}
`

const particlesFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if(dist > 0.5) discard;
  
  // Soft, additive smoke/plasma blur
  float strength = pow(1.0 - (dist * 2.0), 1.5);
  gl_FragColor = vec4(vColor, strength * vAlpha * 0.6);
}
`

export function useThreeScene(options: ThreeSceneOptions): ThreeSceneReturn {
  const { canvas, width, height } = options

  const scene = new THREE.Scene()
  const clock = new THREE.Clock()

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
  // Shift right so the mass is on the right of the screen
  camera.position.set(0, 0, 25)

  const mouse = new THREE.Vector2()
  const targetMouse = new THREE.Vector2()
  const scrollState = { target: 0, current: 0 }

  function onMouseMove(event: MouseEvent) {
    targetMouse.x = (event.clientX / window.innerWidth) * 2 - 1
    targetMouse.y = -(event.clientY / window.innerHeight) * 2 + 1
  }
  window.addEventListener('mousemove', onMouseMove)
  function onScroll(scrollY: number) { scrollState.target = scrollY }

  const dpr = Math.min(Math.max(1, window.devicePixelRatio), 2)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  })
  // Pitch black for high contrast Hermes 4 look
  renderer.setClearColor(new THREE.Color('#020205'), 1)
  renderer.setPixelRatio(dpr)
  renderer.setSize(width, height)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.5

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  })
  composer.addPass(new RenderPass(scene, camera))

  const bloomEffect = new BloomEffect({
    luminanceThreshold: 0.1,
    mipmapBlur: true,
    intensity: 4.0, // HUGE bloom for plasma look
  })
  const vignetteEffect = new VignetteEffect({
    eskil: false,
    offset: 0.3,
    darkness: 0.9,
  })
  composer.addPass(new EffectPass(camera, bloomEffect, vignetteEffect))

  const coreGroup = new THREE.Group()
  // Move the core to the right half of the screen
  coreGroup.position.x = 8
  scene.add(coreGroup)

  // --- Massive Plasma Core Particles ---
  const PARTICLE_COUNT = 15000
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const colors = new Float32Array(PARTICLE_COUNT * 3)
  const sizes = new Float32Array(PARTICLE_COUNT)

  // Tywrap branding: Amber to Blue, with green accents
  const colorAmber = new THREE.Color(0xf59e0b)
  const colorSapphire = new THREE.Color(0x3b82f6)
  const colorNeonGreen = new THREE.Color(0x10b981)

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Generate particles in a dense sphere / elliptical core
    const radius = Math.pow(Math.random(), 2.0) * 12 // Denser at center
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos((Math.random() * 2) - 1)
    
    const x = radius * Math.sin(phi) * Math.cos(theta) * 1.5 // stretch X
    const y = radius * Math.sin(phi) * Math.sin(theta)
    const z = radius * Math.cos(phi) * 0.5 // compress Z

    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    let c: THREE.Color
    const rand = Math.random()
    if (rand < 0.4) c = colorSapphire.clone()
    else if (rand < 0.8) c = colorAmber.clone()
    else c = colorNeonGreen.clone()

    // Blend them together based on position
    if (x > 0) c.lerp(colorSapphire, 0.5)
    else c.lerp(colorAmber, 0.5)

    colors[i * 3 + 0] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b

    // Dynamic sizes: core is dense with small particles, outer is large wisps
    sizes[i] = Math.random() * 4.0 + 1.0 
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.ShaderMaterial({
    vertexShader: particlesVertexShader,
    fragmentShader: particlesFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uScrollCurrent: { value: 0 }
    }
  })

  const particlesMesh = new THREE.Points(geometry, material)
  coreGroup.add(particlesMesh)

  // --- Core Glowing Nodes (Larger accent points) ---
  const nodeGeometry = new THREE.SphereGeometry(0.5, 32, 32) // significantly smaller
  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5, // decreased opacity
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  
  const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, 7)
  const dummy = new THREE.Object3D()
  for(let i=0; i<7; i++) {
    dummy.position.set(
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );
    const s = Math.random() * 1.5 + 0.5;
    dummy.scale.set(s,s,s)
    dummy.updateMatrix()
    nodes.setMatrixAt(i, dummy.matrix)
    
    // Extinguish base colors with multiplier
    let nodeCol = i % 2 === 0 ? colorSapphire.clone() : colorAmber.clone();
    nodes.setColorAt(i, nodeCol) // Removed harsh multiplier
  }
  nodes.instanceMatrix.needsUpdate = true
  if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true
  scene.add(nodes)

  // --- Neural Edges (Axons / Light Streams) ---
  const lineCount = 40
  const linesGroup = new THREE.Group()
  coreGroup.add(linesGroup)
  
  const lineMaterials: THREE.MeshBasicMaterial[] = []

  for(let i=0; i<lineCount; i++) {
    const points = []
    // Random path from center extending outward
    let currentPt = new THREE.Vector3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2)
    for(let step=0; step<15; step++) {
      points.push(currentPt.clone())
      // Wander outward
      const wander = new THREE.Vector3((Math.random()-0.5)*3, (Math.random()-0.5)*3, (Math.random()-0.5)*3)
      currentPt.add(wander).add(currentPt.clone().normalize().multiplyScalar(1.5))
    }
    const curve = new THREE.CatmullRomCurve3(points)
    const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.05, 8, false)
    
    const mat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0x3b82f6 : 0x10b981,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    lineMaterials.push(mat)
    linesGroup.add(new THREE.Mesh(tubeGeo, mat))
  }

  // --- Animation loop ---
  let rafId: number | null = null

  function animate() {
    rafId = requestAnimationFrame(animate)
    const elapsed = clock.getElapsedTime()

    scrollState.current += (scrollState.target - scrollState.current) * 0.05
    
    // Update uniforms
    material.uniforms.uTime.value = elapsed
    material.uniforms.uScrollCurrent.value = scrollState.current
    
    // Smooth camera parallax + Scroll offset
    
    // Core group gently rotates
    coreGroup.rotation.y = elapsed * 0.1
    coreGroup.rotation.x = Math.sin(elapsed * 0.2) * 0.1
    coreGroup.rotation.z = Math.cos(elapsed * 0.1) * 0.05
    
    // Parallax on core
    coreGroup.position.x = 8 + mouse.x * 2.0
    coreGroup.position.y = mouse.y * 2.0 - (scrollState.current * 0.01)

    // Pulse the line opacities
    lineMaterials.forEach((mat, i) => {
      mat.opacity = 0.3 + 0.3 * Math.sin(elapsed * 2.0 + i)
    })

    composer.render()
  }

  function start() {
    clock.start()
    animate()
  }

  function dispose() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    window.removeEventListener('mousemove', onMouseMove)
    composer.dispose()
    renderer.dispose()
    geometry.dispose()
    material.dispose()
  }

  function resize(w: number, h: number) {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }

  return { scene, camera, renderer, start, dispose, resize, onScroll }
}

