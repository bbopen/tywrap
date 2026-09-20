<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useData } from 'vitepress'

const { site } = useData()
const base = computed(() => site.value.base || '/')
const videoUrl = computed(() => base.value + 'media/tywrap-snake-loop.mp4')
const posterUrl = computed(() => base.value + 'media/tywrap-snake-poster.webp')
const gettingStartedUrl = computed(() => base.value + 'guide/getting-started')
const agentGuideUrl = computed(() => base.value + 'llms-full.txt')

const mediaRef = ref<HTMLElement | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)
const reducedMotion = ref(true)
const isPlaying = ref(false)
const videoError = ref(false)
const posterError = ref(false)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

let motionQuery: MediaQueryList | null = null
let visibilityObserver: IntersectionObserver | null = null
let mediaVisible = false
let userPaused = false
let copyTimeout: number | null = null

const benefits = [
  {
    title: 'Reuse your Python work',
    details: 'Connect existing calculations and data tools to your TypeScript app.',
  },
  {
    title: 'Write less integration code',
    details: 'Generate callable functions from Python annotations, with parameter and return types in your editor.',
  },
  {
    title: 'Work with scientific data',
    details: 'Return NumPy arrays and pandas tables to your app. Node and Bun can use Arrow for binary transfer.',
  },
  {
    title: 'Choose where Python runs',
    details: 'Use a local Python process with Node or Bun, or run Python in the browser with Pyodide.',
  },
]

async function playVideo() {
  const video = videoRef.value
  if (!video || reducedMotion.value || videoError.value || !mediaVisible || document.hidden || userPaused) return
  try {
    await video.play()
  } catch {
    // The poster stays visible, and the visitor can try the play control.
    isPlaying.value = false
  }
}

function syncPlayback() {
  const video = videoRef.value
  if (!video) return
  if (reducedMotion.value || !mediaVisible || document.hidden || userPaused) {
    video.pause()
  } else {
    void playVideo()
  }
}

function onMotionChange(event: MediaQueryListEvent) {
  if (event.matches) {
    videoRef.value?.pause()
    isPlaying.value = false
    reducedMotion.value = true
  } else {
    reducedMotion.value = false
    void nextTick(syncPlayback)
  }
}

function togglePlayback() {
  const video = videoRef.value
  if (!video) return
  if (!video.paused) {
    userPaused = true
    video.pause()
  } else {
    userPaused = false
    void playVideo()
  }
}

function onVideoError() {
  videoError.value = true
  isPlaying.value = false
}

async function copyAgentGuide() {
  try {
    const response = await fetch(agentGuideUrl.value)
    if (!response.ok) throw new Error('Agent guide request failed')
    await navigator.clipboard.writeText(await response.text())
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  if (copyTimeout !== null) window.clearTimeout(copyTimeout)
  copyTimeout = window.setTimeout(() => {
    copyState.value = 'idle'
    copyTimeout = null
  }, 5000)
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener('change', onMotionChange)
  document.addEventListener('visibilitychange', syncPlayback)
  if (mediaRef.value && 'IntersectionObserver' in window) {
    visibilityObserver = new IntersectionObserver(entries => {
      mediaVisible = entries[0]?.isIntersecting ?? false
      syncPlayback()
    }, { threshold: 0 })
    visibilityObserver.observe(mediaRef.value)
  } else {
    mediaVisible = true
    void nextTick(syncPlayback)
  }
})

onBeforeUnmount(() => {
  videoRef.value?.pause()
  visibilityObserver?.disconnect()
  motionQuery?.removeEventListener('change', onMotionChange)
  document.removeEventListener('visibilitychange', syncPlayback)
  if (copyTimeout !== null) window.clearTimeout(copyTimeout)
})
</script>

<template>
  <div class="tywrap-home">
    <section class="hero-section" aria-labelledby="hero-title">
      <div class="hero-content">
        <h1 id="hero-title">Use Python libraries in your TypeScript app.</h1>
        <p class="hero-subtitle">
          Run your existing Python functions from TypeScript, with generated
          signatures and autocomplete. Bring NumPy, pandas, and SciPy into your
          app without writing each wrapper by hand.
        </p>
        <div class="hero-actions">
          <a class="get-started" :href="gettingStartedUrl">Get started</a>
          <a class="text-link" :href="base + 'examples/'">See examples</a>
        </div>
      </div>

      <div ref="mediaRef" class="hero-media">
        <span class="sr-only">A lifelike snake moving in a continuous loop.</span>
        <div class="media-fallback" aria-hidden="true">
          <span class="fallback-python">Python</span>
          <span class="fallback-line"></span>
          <span class="fallback-typescript">TypeScript</span>
        </div>
        <img
          v-if="reducedMotion || videoError"
          v-show="!posterError"
          class="hero-poster"
          :src="posterUrl"
          alt=""
          @error="posterError = true"
        />
        <video
          v-else
          ref="videoRef"
          class="hero-video"
          :poster="posterUrl"
          preload="none"
          muted
          playsinline
          loop
          aria-hidden="true"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          @error="onVideoError"
        >
          <source :src="videoUrl" type="video/mp4" />
        </video>
        <button
          v-if="!reducedMotion && !videoError"
          type="button"
          class="video-control"
          :aria-label="isPlaying ? 'Pause snake video' : 'Play snake video'"
          @click="togglePlayback"
        >
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
          </svg>
        </button>
      </div>

      <div class="agent-guide">
        <p>Working with a coding agent? Give it the tywrap guide.</p>
        <div class="agent-guide-actions">
          <button type="button" class="copy-guide" @click="copyAgentGuide">
            {{ copyState === 'copied' ? 'Copied agent guide' : 'Copy agent guide' }}
          </button>
          <a :href="agentGuideUrl">Open guide</a>
        </div>
        <p class="copy-status" role="status" aria-live="polite">
          {{ copyState === 'failed' ? 'Copy failed. Open the guide instead.' : copyState === 'copied' ? 'Agent guide copied to clipboard.' : '' }}
        </p>
      </div>
    </section>

    <section class="benefits" aria-label="What tywrap helps you do">
      <div v-for="benefit in benefits" :key="benefit.title" class="benefit">
        <h2>{{ benefit.title }}</h2>
        <p>{{ benefit.details }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tywrap-home {
  --page-bg: #090f1b;
  --page-text: #f4f7fc;
  --page-muted: #b3c0d1;
  --typescript-blue: #73b7fa;
  --python-amber: #f3c66f;
  background: var(--page-bg);
  color: var(--page-text);
}
.hero-section, .benefits { width: min(100% - 3rem, 1220px); margin-inline: auto; }
.hero-section {
  display: grid;
  grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
  grid-template-areas: "content media" "agent media";
  column-gap: clamp(2.5rem, 5vw, 6rem);
  row-gap: 1.5rem;
  padding-block: clamp(2.5rem, 5vw, 5rem) clamp(3.5rem, 7vw, 6rem);
}
.hero-content { grid-area: content; min-width: 0; align-self: end; }
h1 {
  margin: 0;
  max-width: 11ch;
  font-size: clamp(3rem, 5.1vw, 5.6rem);
  font-weight: 750;
  letter-spacing: -0.055em;
  line-height: 1.04;
  text-wrap: balance;
}
.hero-subtitle {
  margin: 1.6rem 0 0;
  max-width: 38rem;
  color: var(--page-muted);
  font-size: clamp(1.05rem, 1.25vw, 1.2rem);
  line-height: 1.65;
}
.hero-actions, .agent-guide-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 1.25rem; }
.hero-actions { margin-top: 2rem; }
.get-started {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3.1rem;
  padding: 0.7rem 1.35rem;
  border-radius: 0.45rem;
  background: var(--typescript-blue);
  color: #06101e;
  font-weight: 700;
  text-decoration: none;
}
.get-started:hover { background: #a7d3ff; }
.text-link, .agent-guide a { color: var(--page-text); text-underline-offset: 0.3em; }
.text-link:hover, .agent-guide a:hover { color: var(--typescript-blue); }
.agent-guide {
  grid-area: agent;
  padding-top: 1.1rem;
  border-top: 1px solid #29384c;
  color: var(--page-muted);
  font-size: 0.92rem;
}
.agent-guide p { margin: 0 0 0.65rem; }
.copy-guide {
  min-height: 2.5rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid #647c9b;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--page-text);
  cursor: pointer;
  font: inherit;
}
.copy-guide:hover { border-color: var(--typescript-blue); color: var(--typescript-blue); }
.agent-guide .copy-status { min-height: 1.3em; margin-top: 0.45rem; color: #ffc0b8; }
.hero-media {
  grid-area: media;
  align-self: center;
  position: relative;
  aspect-ratio: 4 / 3;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #263448;
  border-radius: 1.1rem;
  background: #101b2d;
  box-shadow: 0 30px 80px #03091199;
}
.media-fallback, .hero-poster, .hero-video { position: absolute; inset: 0; width: 100%; height: 100%; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.media-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: radial-gradient(circle at 50% 48%, #1b3855 0, #101b2d 52%, #0a121f 100%);
  font-size: clamp(1.1rem, 2vw, 1.7rem);
  font-weight: 650;
  letter-spacing: -0.04em;
}
.fallback-python { color: var(--python-amber); }
.fallback-typescript { color: var(--typescript-blue); }
.fallback-line { width: 2.4rem; height: 1px; background: #8b9ab1; }
.hero-poster, .hero-video { display: block; object-fit: cover; object-position: 100% center; }
.video-control {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  border: 1px solid #ffffff88;
  border-radius: 50%;
  background: #07101bbd;
  color: white;
  cursor: pointer;
}
.video-control svg { width: 1.2rem; height: 1.2rem; }
.video-control:hover { background: #0f2641; }
.get-started:focus-visible, .text-link:focus-visible, .copy-guide:focus-visible,
.agent-guide a:focus-visible, .video-control:focus-visible {
  outline: 3px solid var(--python-amber);
  outline-offset: 4px;
}
.benefits {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(1.5rem, 3vw, 3.5rem);
  padding-block: 2rem 4.5rem;
  border-top: 1px solid #29384c;
}
.benefit h2 {
  margin: 0 0 0.7rem;
  color: var(--page-text);
  font-size: 1.05rem;
  font-weight: 650;
  line-height: 1.3;
}
.benefit p { margin: 0; color: var(--page-muted); font-size: 0.94rem; line-height: 1.55; }
@media (max-width: 1000px) {
  .hero-section {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "content" "media" "agent";
    row-gap: 2.5rem;
  }
  h1 { max-width: 13ch; }
  .hero-media { aspect-ratio: 16 / 10; }
  .benefits { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .hero-section, .benefits { width: min(100% - 2rem, 1220px); }
  .hero-section { padding-top: 2.5rem; padding-bottom: 3rem; }
  h1 { font-size: clamp(2.75rem, 12vw, 3.8rem); }
  .hero-subtitle { margin-top: 1.3rem; }
  .hero-media { aspect-ratio: 4 / 3; }
  .benefits { grid-template-columns: 1fr; gap: 1.7rem; padding-bottom: 3rem; }
}
</style>
