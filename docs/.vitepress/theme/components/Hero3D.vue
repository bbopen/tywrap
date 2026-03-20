<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'
import { useThreeScene, type ThreeSceneReturn } from '../composables/useThreeScene'

const { site } = useData()
const canvasRef = ref<HTMLCanvasElement | null>(null)
let threeScene: ThreeSceneReturn | null = null

function getBase(): string {
  return site.value.base || '/'
}

onMounted(() => {
  if (!canvasRef.value) return

  const w = window.innerWidth
  const h = window.innerHeight

  threeScene = useThreeScene({
    canvas: canvasRef.value,
    width: w,
    height: h,
  })
  threeScene.start()

  window.addEventListener('resize', onResize)
})

function onResize() {
  if (!threeScene) return
  threeScene.resize(window.innerWidth, window.innerHeight)
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (threeScene) {
    threeScene.dispose()
    threeScene = null
  }
})
</script>

<template>
  <section class="hero-section">
    <!-- Three.js Canvas -->
    <canvas ref="canvasRef" class="hero-canvas" />

    <!-- Radial gradient overlay -->
    <div class="hero-overlay" />

    <!-- Content -->
    <div class="hero-content">
      <h1 class="hero-headline fade-up">
        Wrap Python in <br />
        <span class="hero-gradient-text">TypeScript Safety</span>
      </h1>

      <p class="hero-subtitle fade-up delay-1">
        The ultimate bridge for secure and efficient cross-language development.
        Seamlessly integrate and protect your Python assets with TypeScript's robust type system.
      </p>

      <div class="hero-actions fade-up delay-2">
        <a :href="getBase() + 'guide/getting-started'" class="btn-primary">
          Explore the Code Weaver
        </a>
        <a :href="getBase() + 'reference/api/'" class="btn-secondary">
          View Documentation
        </a>
      </div>
    </div>

    <!-- Floating Code Snippets (desktop only) -->
    <div class="floating-snippet snippet-python">
      <div class="snippet-header snippet-header-amber">
        <span class="snippet-icon snippet-icon-amber">Py</span>
        python
      </div>
      <pre class="snippet-code snippet-code-amber">def py_func():
  import ts_mod
  return ts_mod.call()</pre>
    </div>

    <div class="floating-snippet snippet-typescript">
      <div class="snippet-header snippet-header-blue">
        <span class="snippet-icon snippet-icon-blue">Ts</span>
        typescript
      </div>
      <pre class="snippet-code snippet-code-blue">interface ts_mod {
  call(): string;
}</pre>
    </div>

    <!-- Floating Labels (desktop only) -->
    <div class="floating-label label-python">python -&gt;</div>
    <div class="floating-label label-typescript">&lt;- ts_mod</div>
  </section>
</template>

<style scoped>
/* ----------------------------------------------------------------
   Section & Canvas
   ---------------------------------------------------------------- */
.hero-section {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 5rem;
  overflow: hidden;
  background: #0a0c10;
}

.hero-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

/* ----------------------------------------------------------------
   Overlay
   ---------------------------------------------------------------- */
.hero-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(0, 0, 0, 0.4) 0%, transparent 60%);
  z-index: 0;
  pointer-events: none;
}

/* ----------------------------------------------------------------
   Content
   ---------------------------------------------------------------- */
.hero-content {
  position: relative;
  z-index: 10;
  max-width: 56rem;
  padding-left: 1.5rem;
  padding-right: 1.5rem;
  text-align: center;
  margin-top: 16rem;
}

.hero-headline {
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.1;
  color: #ffffff;
  margin-bottom: 1.5rem;
  filter: drop-shadow(0 25px 25px rgba(0, 0, 0, 0.5));
}

@media (min-width: 768px) {
  .hero-headline {
    font-size: 4.5rem;
  }
}

.hero-gradient-text {
  background: linear-gradient(to right, #60a5fa, #fbbf24);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 15px rgba(255, 255, 255, 0.3));
}

.hero-subtitle {
  font-size: 1.125rem;
  color: #d1d5db;
  margin-bottom: 2.5rem;
  max-width: 42rem;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.625;
  filter: drop-shadow(0 10px 8px rgba(0, 0, 0, 0.4));
  font-weight: 500;
}

@media (min-width: 768px) {
  .hero-subtitle {
    font-size: 1.25rem;
  }
}

/* ----------------------------------------------------------------
   Actions
   ---------------------------------------------------------------- */
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

.btn-primary,
.btn-secondary {
  display: inline-block;
  width: 100%;
  padding: 1rem 2rem;
  font-weight: 700;
  border-radius: 9999px;
  text-align: center;
  transition: all 0.2s ease;
  text-decoration: none;
  cursor: pointer;
}

@media (min-width: 640px) {
  .btn-primary,
  .btn-secondary {
    width: auto;
  }
}

.btn-primary {
  background: #f4b459;
  color: #000000;
  box-shadow: 0 20px 25px -5px rgba(245, 158, 11, 0.2);
}

.btn-primary:hover {
  background: #e5a348;
  transform: scale(1.05);
}

.btn-primary:active {
  transform: scale(0.95);
}

.btn-secondary {
  background: transparent;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.05);
  transform: scale(1.05);
}

.btn-secondary:active {
  transform: scale(0.95);
}

/* ----------------------------------------------------------------
   Floating Code Snippets
   ---------------------------------------------------------------- */
.floating-snippet {
  position: absolute;
  opacity: 0.4;
  pointer-events: none;
  display: none;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@media (min-width: 1024px) {
  .floating-snippet {
    display: block;
  }
}

.snippet-python {
  top: 20%;
  left: 15%;
}

.snippet-typescript {
  top: 25%;
  right: 15%;
}

.snippet-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1.125rem;
}

.snippet-header-amber {
  color: #f59e0b;
}

.snippet-header-blue {
  color: #3b82f6;
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

.snippet-icon-amber {
  background: rgba(245, 158, 11, 0.2);
}

.snippet-icon-blue {
  background: rgba(59, 130, 246, 0.2);
}

.snippet-code {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.75rem;
  margin-top: 0.5rem;
  white-space: pre;
}

.snippet-code-amber {
  color: rgba(251, 191, 36, 0.6);
}

.snippet-code-blue {
  color: rgba(96, 165, 250, 0.6);
}

/* ----------------------------------------------------------------
   Floating Labels
   ---------------------------------------------------------------- */
.floating-label {
  position: absolute;
  opacity: 0.2;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.875rem;
  display: none;
}

@media (min-width: 1024px) {
  .floating-label {
    display: block;
  }
}

.label-python {
  bottom: 30%;
  left: 20%;
  color: #f59e0b;
}

.label-typescript {
  bottom: 35%;
  right: 20%;
  color: #3b82f6;
}

/* ----------------------------------------------------------------
   Animations
   ---------------------------------------------------------------- */
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
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.2;
  }
}

.fade-up {
  animation: fadeUp 0.8s ease-out both;
}

.delay-1 {
  animation-delay: 0.2s;
}

.delay-2 {
  animation-delay: 0.4s;
}
</style>
