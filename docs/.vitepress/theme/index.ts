import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import { useRoute } from 'vitepress'
import HeroVideo from './components/HeroVideo.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    const route = useRoute()
    const isHome = route.path === '/' || route.path.replace(/\/$/, '') === '/tywrap'
    return h(DefaultTheme.Layout, null, {
      ...(isHome ? { 'layout-top': () => h(HeroVideo) } : {}),
    })
  },
} satisfies Theme
