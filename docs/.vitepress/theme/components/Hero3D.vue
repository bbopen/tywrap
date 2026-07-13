<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'
import { useThreeScene, type ThreeSceneReturn } from '../composables/useThreeScene'

const { site } = useData()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLDivElement | null>(null)
let threeScene: ThreeSceneReturn | null = null
let scrollTicking = false
let scrollRafId: number | null = null
let motionQuery: MediaQueryList | null = null

const features = [
  {
    title: 'Call the scientific stack from TypeScript',
    details:
      'numpy, pandas, scipy, torch, and sklearn results arrive typed, over Apache Arrow with JSON fallback.',
  },
  {
    title: 'Generate, don’t hand-write',
    details:
      'npx tywrap generate reads annotated Python source and emits TypeScript wrappers with real signatures.',
  },
  {
    title: 'Same wrapper, four runtimes',
    details:
      'Node, Bun, and Deno subprocess bridges, Pyodide in the browser, or a remote HTTP server.',
  },
  {
    title: 'A boundary that won’t lie',
    details:
      'Values that can’t be preserved fail loudly with a named error and a recipe, never a silently wrong result.',
  },
]

function getBase(): string {
  return site.value.base || '/'
}

const copied = ref(false)
const copyFailed = ref(false)
let copyTimeout: number | null = null

async function copyPrompt() {
  try {
    const response = await fetch(getBase() + 'llms-full.txt')
    if (!response.ok) throw new Error('Failed to fetch llms-full.txt')
    const text = await response.text()

    await navigator.clipboard.writeText(text)

    copied.value = true
    copyFailed.value = false
  } catch (err) {
    console.error('Failed to copy prompt: ', err)
    copied.value = false
    copyFailed.value = true
  }
  if (copyTimeout !== null) window.clearTimeout(copyTimeout)
  copyTimeout = window.setTimeout(() => {
    copied.value = false
    copyFailed.value = false
    copyTimeout = null
  }, 2500)
}

// Fade the fixed canvas and overlay out as the hero scrolls away so the
// animation never bleeds under the docs content below.
function applyScrollEffects(scrollY: number) {
  threeScene?.onScroll(scrollY)
  const fadeEnd = Math.max(1, window.innerHeight * 0.85)
  const opacity = Math.max(0, 1 - scrollY / fadeEnd).toFixed(3)
  if (canvasRef.value) canvasRef.value.style.opacity = opacity
  if (overlayRef.value) overlayRef.value.style.opacity = opacity
}

// Ensure the scroll event is throttled by requestAnimationFrame
function onScroll() {
  if (!scrollTicking) {
    scrollTicking = true
    scrollRafId = window.requestAnimationFrame(() => {
      scrollRafId = null
      scrollTicking = false
      applyScrollEffects(window.scrollY)
    })
  }
}

function setupScene() {
  if (threeScene || !canvasRef.value) return
  canvasRef.value.style.display = ''
  if (overlayRef.value) overlayRef.value.style.display = ''
  threeScene = useThreeScene({
    canvas: canvasRef.value,
    width: window.innerWidth,
    height: window.innerHeight,
  })
  applyScrollEffects(window.scrollY)
  threeScene.start()
}

function teardownScene() {
  if (threeScene) {
    threeScene.dispose()
    threeScene = null
  }
  // An undrawn canvas is a stray dark box; hide it and the overlay entirely.
  if (canvasRef.value) canvasRef.value.style.display = 'none'
  if (overlayRef.value) overlayRef.value.style.display = 'none'
}

// React to prefers-reduced-motion changes mid-session, not just at mount.
function onMotionPreferenceChange(event: MediaQueryListEvent) {
  if (event.matches) teardownScene()
  else setupScene()
}

// Stop rendering entirely while the tab is hidden.
function onVisibilityChange() {
  if (!threeScene) return
  if (document.hidden) threeScene.pause()
  else threeScene.resume()
}

onMounted(() => {
  if (!canvasRef.value) return

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionQuery.addEventListener('change', onMotionPreferenceChange)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (motionQuery.matches) {
    teardownScene()
    return
  }
  setupScene()
})

function onResize() {
  if (!threeScene) return
  threeScene.resize(window.innerWidth, window.innerHeight)
}

onBeforeUnmount(() => {
  if (copyTimeout !== null) {
    window.clearTimeout(copyTimeout)
    copyTimeout = null
  }
  if (scrollRafId !== null) {
    window.cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  scrollTicking = false
  motionQuery?.removeEventListener('change', onMotionPreferenceChange)
  motionQuery = null
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('visibilitychange', onVisibilityChange)
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
  <div ref="overlayRef" class="hero-overlay" aria-hidden="true" />

  <!-- Interactive Content Container -->
  <section class="hero-section" aria-label="tywrap hero — wrap Python in TypeScript safety">
    <div class="hero-content">
      <h1 class="hero-headline fade-up">
        Wrap Python in <br class="headline-break" />
        TypeScript Safety
      </h1>

      <p class="hero-subtitle fade-up delay-1">
        Generate TypeScript bindings from annotated Python source and call
        numpy, pandas, torch, and scipy from Node, Bun, Deno, or the browser.
        The types come from the Python code itself.
      </p>

      <div class="hero-actions fade-up delay-2">
        <div class="copy-agent-block">
          <p class="copy-instruction">Copy this into your coding agent to get started in one shot:</p>

          <button class="prompt-copy-container" @click="copyPrompt" :class="{ 'copied': copied, 'copy-failed': copyFailed }" aria-label="Copy full LLM prompt">
            <span class="prompt-text">
              <span class="prompt-prefix" aria-hidden="true">❯</span>
              <span class="prompt-url">https://bbopen.github.io/tywrap/llms-full.txt</span>
            </span>
            <span class="copy-icon-wrapper">
              <span class="copied-label" v-if="copied">Copied!</span>
              <span class="copied-label" v-else-if="copyFailed">Copy failed</span>
              <svg v-if="!copied && !copyFailed" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <svg v-else-if="copied" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
          </button>
          <span class="sr-only" role="status">{{ copied ? 'Copied to clipboard' : copyFailed ? 'Copy failed. Open the URL in a browser instead.' : '' }}</span>

          <a :href="getBase() + 'reference/api/'" class="link-secondary">
            View full documentation <span class="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>

    <!-- Right Column: Feature List -->
    <div class="hero-features fade-up delay-3">
      <div v-for="feature in features" :key="feature.title" class="feature-row">
        <p class="feature-title">{{ feature.title }}</p>
        <p class="feature-details">{{ feature.details }}</p>
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
  /* Portrait: the text column spans the full width, so darken uniformly */
  background: rgba(0, 0, 0, 0.7);
  z-index: -1;
  pointer-events: none;
}

@media (min-width: 1024px) {
  .hero-overlay {
    /* Wide: darken the left side where the text lives, let the scene breathe right */
    background: linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 40%, transparent 100%);
  }
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
  text-wrap: balance;
  text-shadow: 0 0 40px rgba(0, 0, 0, 0.9), 0 4px 10px rgba(0, 0, 0, 0.5);
}

.headline-break {
  display: none;
}

@media (min-width: 768px) {
  .hero-headline {
    font-size: 5rem;
  }
  .headline-break {
    display: inline;
  }
}

.hero-subtitle {
  font-size: 1.125rem;
  color: #d1d5db;
  margin-bottom: 3rem;
  line-height: 1.7;
  max-width: 38rem;
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
  color: #e5e7eb;
  font-family: var(--vp-font-family-mono);
  margin: 0;
  letter-spacing: -0.01em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}

.prompt-copy-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 32rem;
  padding: 1rem 1.25rem;
  background: rgba(5, 5, 8, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.75rem;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  color: #e5e7eb;
  font-family: var(--vp-font-family-mono);
  font-size: 0.95rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
}

.prompt-copy-container:hover {
  background: rgba(15, 15, 20, 0.96);
  border-color: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
}

.prompt-copy-container:active {
  transform: translateY(1px);
  box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.4);
}

.prompt-copy-container:focus-visible,
.link-secondary:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 3px;
}

.prompt-copy-container.copied {
  background: rgba(6, 47, 34, 0.95);
  border-color: rgba(52, 211, 153, 0.55);
  color: #6ee7b7;
}

.prompt-copy-container.copy-failed {
  background: rgba(60, 12, 12, 0.95);
  border-color: rgba(248, 113, 113, 0.55);
  color: #fca5a5;
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

@media (max-width: 640px) {
  .prompt-url {
    white-space: normal;
    word-break: break-all;
    overflow: visible;
    font-size: 0.85rem;
  }
}

.copy-icon-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #b6bcc8;
  flex-shrink: 0;
  margin-left: 1rem;
  transition: color 0.2s ease;
}

.prompt-copy-container:hover .copy-icon-wrapper {
  color: #ffffff;
}

.prompt-copy-container.copied .copy-icon-wrapper {
  color: #6ee7b7;
}

.prompt-copy-container.copy-failed .copy-icon-wrapper {
  color: #fca5a5;
}

.copied-label {
  font-size: 0.85rem;
  font-weight: 600;
  animation: fadeIn 0.3s ease;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Secondary Link */
.link-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  color: #c2c8d4;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;
  margin-top: 0.25rem;
  padding: 0.5rem 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
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
  margin-top: 3rem;
  width: 100%;
  max-width: 28rem;
  flex-shrink: 0;
  background: rgba(5, 5, 8, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.75rem;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

@media (min-width: 1024px) {
  .hero-features {
    margin-top: 0;
    margin-left: 4rem;
  }
}

.feature-row {
  padding: 1.15rem 1.4rem;
}

.feature-row + .feature-row {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.feature-title {
  color: #ffffff;
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.35rem 0;
  line-height: 1.3;
}

.feature-details {
  color: #d1d5db;
  font-size: 0.9rem;
  margin: 0;
  line-height: 1.6;
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
  .prompt-copy-container,
  .link-secondary .arrow {
    transition: none;
  }
}
</style>
