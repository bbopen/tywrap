<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'
import { useThreeScene, type ThreeSceneReturn } from '../composables/useThreeScene'

const { site } = useData()
const canvasRef = ref<HTMLCanvasElement | null>(null)
let threeScene: ThreeSceneReturn | null = null
let scrollTicking = false

function getBase(): string {
  return site.value.base || '/'
}

// Ensure the scroll event is throttled by requestAnimationFrame
function onScroll() {
  if (!scrollTicking && threeScene && threeScene.onScroll) {
    window.requestAnimationFrame(() => {
      threeScene!.onScroll(window.scrollY)
      scrollTicking = false
    })
    scrollTicking = true
  }
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
  window.addEventListener('scroll', onScroll, { passive: true })
})

function onResize() {
  if (!threeScene) return
  threeScene.resize(window.innerWidth, window.innerHeight)
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onScroll)
  if (threeScene) {
    threeScene.dispose()
    threeScene = null
  }
})
</script>

<template>
  <!-- Fixed Background Canvas -->
  <canvas ref="canvasRef" class="hero-canvas" />
  <!-- Gradient overlay to ensure text legibility -->
  <div class="hero-overlay" />

  <!-- Interactive Content Container -->
  <section class="hero-section">
    <div class="hero-content">
      <h1 class="hero-headline fade-up">
        Wrap Python in <br />
        <span class="hero-gradient-text">TypeScript Safety</span>
      </h1>

      <p class="hero-subtitle fade-up delay-1">
        Seamlessly integrate the unmatched computational power of Python's elite ecosystem—like PyTorch, SciPy, pandas, and NumPy—directly within your TypeScript applications, fully protected by a robust type system.
      </p>

      <div class="hero-actions fade-up delay-2">
        <a :href="getBase() + 'guide/getting-started'" class="btn-primary">
          Get Started
        </a>
        <a :href="getBase() + 'reference/api/'" class="btn-secondary">
          View Documentation
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ----------------------------------------------------------------
   Section & Canvas
   ---------------------------------------------------------------- */
.hero-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -2;
  pointer-events: none;
}

.hero-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  /* Darken the left side to ensure the text pops */
  background: linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 40%, transparent 100%);
  z-index: -1;
  pointer-events: none;
}

.hero-section {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start; /* Force left alignment */
  z-index: 10;
  width: 100%;
  padding-bottom: 5rem;
  /* Align to Vitepress standard left container edge */
  padding-left: max(24px, calc((100vw - var(--vp-layout-max-width, 1152px)) / 2));
}

/* ----------------------------------------------------------------
   Content (Asymmetrical Left-Aligned)
   ---------------------------------------------------------------- */
.hero-content {
  position: relative;
  max-width: 44rem; /* Restrict width to keep left-aligned */
  padding-top: 4rem;
  text-align: left;
}

.hero-headline {
  font-size: 3.5rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.1;
  color: #ffffff;
  margin-bottom: 2rem;
  text-shadow: 0 0 40px rgba(0, 0, 0, 0.9), 0 4px 10px rgba(0, 0, 0, 0.5);
}

@media (min-width: 768px) {
  .hero-headline {
    font-size: 5rem;
  }
}

.hero-gradient-text {
  background: linear-gradient(to right, #60a5fa, #c084fc, #10b981, #f59e0b);
  background-size: 300% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-stroke: 1px rgba(255, 255, 255, 0.2);
  color: transparent;
  text-shadow: 0 0 20px rgba(255, 255, 255, 0.1);
  animation: shimmer 8s linear infinite;
}

@keyframes shimmer {
  to {
    background-position: 300% center;
  }
}

.hero-subtitle {
  font-size: 1.125rem;
  color: #d1d5db;
  margin-bottom: 3rem;
  line-height: 1.7;
  text-shadow: 0 0 30px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.8);
  font-weight: 500;
}

@media (min-width: 768px) {
  .hero-subtitle {
    font-size: 1.35rem;
  }
}

/* ----------------------------------------------------------------
   Actions
   ---------------------------------------------------------------- */
.hero-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1.5rem;
}

@media (min-width: 640px) {
  .hero-actions {
    flex-direction: row;
  }
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 1rem 2.5rem;
  font-weight: 700;
  font-size: 1.125rem;
  border-radius: 9999px;
  text-align: center;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  text-decoration: none;
  cursor: pointer;
  letter-spacing: 0.05em;
}

@media (min-width: 640px) {
  .btn-primary,
  .btn-secondary {
    width: auto;
  }
}

/* Brutalist modern key style for buttons, adapting Hermes 4 feel */
.btn-primary {
  background: #f4b459; /* Amber/Python focus */
  color: #000000;
  border: 2px solid transparent;
  box-shadow: 0 4px 0 #b45309, 0 10px 20px -5px rgba(245, 158, 11, 0.4);
}

.btn-primary:hover {
  background: #fcd34d;
  box-shadow: 0 6px 0 #d97706, 0 15px 30px -5px rgba(245, 158, 11, 0.6);
  transform: translateY(-2px);
}

.btn-primary:active {
  box-shadow: 0 0px 0 #b45309, 0 5px 10px -5px rgba(245, 158, 11, 0.4);
  transform: translateY(4px);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 4px 0 rgba(255, 255, 255, 0.1), 0 10px 30px rgba(0, 0, 0, 0.2);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 6px 0 rgba(255, 255, 255, 0.2), 0 15px 40px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}

.btn-secondary:active {
  box-shadow: 0 0px 0 rgba(255, 255, 255, 0.2), 0 5px 10px rgba(0, 0, 0, 0.2);
  transform: translateY(4px);
}

/* ----------------------------------------------------------------
   Animations
   ---------------------------------------------------------------- */
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-up {
  animation: fadeUp 1s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.delay-1 {
  animation-delay: 0.2s;
}

.delay-2 {
  animation-delay: 0.4s;
}
</style>
