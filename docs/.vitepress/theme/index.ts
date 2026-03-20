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
