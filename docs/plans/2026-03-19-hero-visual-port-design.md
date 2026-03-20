# Hero Visual Port: React Three Fiber → VitePress/Vue

**Date:** 2026-03-19
**Source:** `bbopen/tywrap-hero-visual` (private repo)
**Target:** `docs/.vitepress/theme/` in tywrap main repo

## Decisions

- **Full hero replacement** — Option C: custom Vue component replaces VitePress default hero entirely
- **Raw Three.js** — Option A: imperative scene in Vue `onMounted`, no TresJS or other wrapper
- **1:1 port** — Every geometry, material, animation, overlay element, and floating decoration preserved
- **CSS animations** replace Framer Motion entrance effects
- **codecert verification** — Formal execution-free patch equivalence certificate after implementation

## New Dependencies

- `three` (Three.js core)
- `postprocessing` (Bloom effect — same lib used by `@react-three/postprocessing`)

## Components

| File | Purpose |
|------|---------|
| `docs/.vitepress/theme/components/Hero3D.vue` | Full custom hero: Three.js canvas + text overlay + floating snippets + CTA buttons |
| `docs/.vitepress/theme/composables/useThreeScene.ts` | Composable: renderer, camera, scene graph, lights, geometries, materials, animation loop, bloom post-processing |
| `docs/.vitepress/theme/custom.css` | Hide VitePress default hero, dark background, gradient text utilities, entrance animations |
| `docs/.vitepress/theme/index.ts` | Wire Hero3D into `layout-top` slot (home page only) |

## Scene Graph (1:1 from React source)

```
Canvas (alpha, dpr [1,2], antialias off)
├── PerspectiveCamera (pos [0,0,12], fov 45)
├── AmbientLight (0.2)
├── PointLight (pos [10,10,10], intensity 1)
├── PointLight (pos [-10,-10,-10], #3b82f6, intensity 2)
├── Float group (speed 2, rotationIntensity 0.5, floatIntensity 0.5)
│   ├── Core group (rotation x*0.4, y*0.3)
│   │   ├── Torus — Python ring (#f59e0b, emissive 2, rot [π/2,0,0], r=1.2, tube=0.08)
│   │   ├── Torus — TypeScript ring (#3b82f6, emissive 2, rot [0,π/2,0], r=1.2, tube=0.08)
│   │   └── Sphere — inner glow (#fff, emissive 1, r=0.7)
│   ├── GlassShield — Icosahedron (r=2.4, detail 1, transmission, ior 1.5, clearcoat)
│   │   └── Edges (threshold 15, #3b82f6)
│   ├── LightStream — amber (#f59e0b, speed 0.8, offset 0, r=3.5, h=8, intensity 5)
│   └── LightStream — blue (#3b82f6, speed -1, offset π, r=4, h=8, intensity 5)
├── Sparkles (#3b82f6, count 200, scale 15, size 2, speed 0.2, opacity 0.5)
├── Sparkles (#f59e0b, count 100, scale 15, size 3, speed 0.4, opacity 0.3)
├── Environment (preset "city")
└── EffectComposer
    └── Bloom (luminanceThreshold 1, mipmapBlur, intensity 1.0)
```

## HTML Overlay (1:1 from Hero.tsx)

- Radial gradient overlay for text contrast
- Headline: "Wrap Python in" / "TypeScript Safety" (gradient blue→amber)
- Subheadline paragraph
- Two CTA buttons (amber primary, transparent outline secondary)
- Floating code snippets: Python (top-left), TypeScript (top-right)
- Floating labels: "python →" (bottom-left), "← ts_mod" (bottom-right)

## Verification: codecert Patch Equivalence

After implementation, run codecert to produce a formal execution-free verification certificate:

1. **Scene manifest extraction** — Parse both `ThreeScene.tsx` (React source) and `useThreeScene.ts` (Vue port) to extract every geometry, material, light, camera, animation, and post-processing parameter
2. **Parameter-by-parameter equivalence** — Assert exact match on all ~60 parameters across the scene graph
3. **HTML overlay equivalence** — Compare text content, CSS values, gradient definitions, positioning between `Hero.tsx` and `Hero3D.vue`
4. **Animation formula equivalence** — Verify rotation multipliers, curve generation math, Float simulation parameters
5. **Formal conclusion** — Certificate with evidence traces for each equivalence claim

## Known Non-Identical Elements

- Font rendering (React DOM vs Vue DOM — subpixel differences)
- `@react-three/drei` `Environment` preset "city" — load same HDR environment map
- `Float` animation — reimplement sinusoidal bob/rotation math from drei source
- Framer Motion → CSS `@keyframes` — same visual effect, different mechanism
