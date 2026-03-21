<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'
import { useThreeScene, type ThreeSceneReturn } from '../composables/useThreeScene'

const { site } = useData()
const canvasRef = ref<HTMLCanvasElement | null>(null)
let threeScene: ThreeSceneReturn | null = null
let scrollTicking = false
let scrollRafId: number | null = null

const features = [
  { icon: '🔒', title: 'Full Type Safety', details: 'TypeScript definitions generated directly from Python source analysis via AST — no manual type writing.' },
  { icon: '🌐', title: 'Multi-Runtime', details: 'One API across Node.js, Bun, Deno (subprocess), and browsers (Pyodide WebAssembly).' },
  { icon: '⚡', title: 'Rich Data Types', details: 'First-class support for numpy, pandas, scipy, torch, and sklearn with Apache Arrow binary transport.' },
  { icon: '🛠', title: 'Zero-Config CLI', details: 'Run <code>npx tywrap generate</code> and get production-ready TypeScript wrappers with a single command.' }
]

function getBase(): string {
  return site.value.base || '/'
}

const copied = ref(false)
let copyTimeout: number

async function copyPrompt() {
  try {
    const response = await fetch(getBase() + 'llms-full.txt')
    if (!response.ok) throw new Error('Failed to fetch llms-full.txt')
    const text = await response.text()
    
    await navigator.clipboard.writeText(text)
    
    copied.value = true
    if (copyTimeout) clearTimeout(copyTimeout)
    copyTimeout = window.setTimeout(() => {
      copied.value = false
    }, 2500)
  } catch (err) {
    console.error('Failed to copy prompt: ', err)
  }
}

// Ensure the scroll event is throttled by requestAnimationFrame
function onScroll() {
  if (!scrollTicking && threeScene && threeScene.onScroll) {
    scrollTicking = true
    scrollRafId = window.requestAnimationFrame(() => {
      scrollRafId = null
      scrollTicking = false
      threeScene?.onScroll(window.scrollY)
    })
  }
}

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

onMounted(() => {
  if (!canvasRef.value) return

  // Skip all canvas animation when the user prefers reduced motion
  if (prefersReducedMotion()) return

  const w = window.innerWidth
  const h = window.innerHeight

  threeScene = useThreeScene({
    canvas: canvasRef.value,
    width: w,
    height: h,
  })
  threeScene.onScroll(window.scrollY)
  threeScene.start()

  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onScroll, { passive: true })
})

function onResize() {
  if (!threeScene) return
  threeScene.resize(window.innerWidth, window.innerHeight)
}

onBeforeUnmount(() => {
  if (scrollRafId !== null) {
    window.cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  scrollTicking = false
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
  <canvas ref="canvasRef" class="hero-canvas" aria-hidden="true" />
  <!-- Gradient overlay to ensure text legibility -->
  <div class="hero-overlay" aria-hidden="true" />

  <!-- Interactive Content Container -->
  <section class="hero-section" aria-label="tywrap hero — wrap Python in TypeScript safety">
    <div class="hero-content">
      <h1 class="hero-headline fade-up">
        Wrap Python in <br />
        <span class="hero-gradient-text">TypeScript Safety</span>
      </h1>

      <p class="hero-subtitle fade-up delay-1">
        Seamlessly integrate the unmatched computational power of Python's elite ecosystem—like PyTorch, SciPy, pandas, and NumPy—directly within your TypeScript applications, fully protected by a robust type system.
      </p>

      <div class="hero-actions fade-up delay-2">
        <div class="copy-agent-block">
          <p class="copy-instruction">Copy this into your coding agent to get started in one shot:</p>
          
          <button class="prompt-copy-container" @click="copyPrompt" :class="{ 'copied': copied }" aria-label="Copy full LLM prompt">
            <span class="prompt-text">
              <span class="prompt-prefix">❯</span>
              <span class="prompt-url">https://bbopen.github.io/tywrap/llms-full.txt</span>
            </span>
            <span class="copy-icon-wrapper">
              <span class="copied-label" v-if="copied">Copied!</span>
              <svg v-if="!copied" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
          </button>

          <a :href="getBase() + 'reference/api/'" class="link-secondary">
            View full documentation <span class="arrow">→</span>
          </a>
        </div>
      </div>
    </div>

    <!-- Right Column: Extracted Features -->
    <div class="hero-features fade-up delay-3">
      <div v-for="(feature, idx) in features" :key="idx" class="feature-card">
        <div class="feature-icon">{{ feature.icon }}</div>
        <div class="feature-text">
          <h3 class="feature-title">{{ feature.title }}</h3>
          <p class="feature-details" v-html="feature.details"></p>
        </div>
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
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  z-index: 10;
  width: 100%;
  padding-bottom: 2rem;
  padding-top: 8rem;
  box-sizing: border-box;
  padding-left: max(24px, calc((100vw - var(--vp-layout-max-width, 1152px)) / 2));
  padding-right: max(24px, calc((100vw - var(--vp-layout-max-width, 1152px)) / 2));
}

@media (min-width: 1024px) {
  .hero-section {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

/* ----------------------------------------------------------------
   Content (Asymmetrical Left-Aligned)
   ---------------------------------------------------------------- */
.hero-content {
  position: relative;
  max-width: 44rem;
  width: 100%;
  text-align: left;
  flex: 1;
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
  width: 100%;
}

.copy-agent-block {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 1rem;
}

.copy-instruction {
  font-size: 0.95rem;
  color: #9ca3af;
  font-family: var(--vp-font-family-mono);
  margin: 0;
  letter-spacing: -0.01em;
}

.prompt-copy-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 32rem;
  padding: 1rem 1.25rem;
  background: rgba(15, 15, 15, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.75rem;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  transition: all 0.2s ease;
  color: #d1d5db;
  font-family: var(--vp-font-family-mono);
  font-size: 0.95rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
}

.prompt-copy-container:hover {
  background: rgba(25, 25, 25, 0.8);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
}

.prompt-copy-container:active {
  transform: translateY(1px);
  box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.4);
}

.prompt-copy-container.copied {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

.prompt-text {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  overflow: hidden;
  text-align: left;
}

.prompt-prefix {
  color: #f4b459; /* Amber/Python focus */
  font-weight: 700;
  user-select: none;
}

.prompt-url {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.copy-icon-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #9ca3af;
  flex-shrink: 0;
  margin-left: 1rem;
  transition: color 0.2s ease;
}

.prompt-copy-container:hover .copy-icon-wrapper {
  color: #ffffff;
}

.prompt-copy-container.copied .copy-icon-wrapper {
  color: #10b981;
}

.copied-label {
  font-size: 0.85rem;
  font-weight: 600;
  animation: fadeIn 0.3s ease;
}

/* Secondary Link */
.link-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  color: #9ca3af;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;
  margin-top: 0.25rem;
}

.link-secondary:hover {
  color: #ffffff;
}

.link-secondary .arrow {
  transition: transform 0.2s ease;
}

.link-secondary:hover .arrow {
  transform: translateX(4px);
}

/* ----------------------------------------------------------------
   Features (Right Column)
   ---------------------------------------------------------------- */
.hero-features {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 3rem;
  width: 100%;
  max-width: 28rem;
  flex-shrink: 0;
}

@media (min-width: 1024px) {
  .hero-features {
    margin-top: 0;
    margin-left: 4rem;
  }
}

.feature-card {
  display: flex;
  align-items: flex-start;
  background: rgba(15, 15, 15, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1rem;
  padding: 1.25rem;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.feature-card:hover {
  background: rgba(25, 25, 25, 0.85);
  transform: translateX(-4px);
  border-color: rgba(255, 255, 255, 0.2);
}

.feature-icon {
  font-size: 1.5rem;
  margin-right: 1.25rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.feature-text {
  flex: 1;
}

.feature-title {
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  line-height: 1.2;
}

.feature-details {
  color: #d1d5db;
  font-size: 0.9rem;
  margin: 0;
  line-height: 1.6;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.feature-details :deep(code) {
  background: rgba(255, 255, 255, 0.1);
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8em;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
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

.delay-3 {
  animation-delay: 0.6s;
}

/* Disable all decorative animations for motion-sensitive users */
@media (prefers-reduced-motion: reduce) {
  .fade-up {
    animation: none;
  }
  .hero-gradient-text {
    animation: none;
  }
}
</style>
