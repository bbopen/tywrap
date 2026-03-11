import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'tywrap',
  description: 'Generate type-safe TypeScript wrappers for any Python library — Node.js, Deno, Bun, and browsers via Pyodide.',
  base: '/tywrap/',
  cleanUrls: true,

  themeConfig: {
    siteTitle: 'tywrap',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'GitHub',
        link: 'https://github.com/bbopen/tywrap',
      },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
          {
            text: 'Runtime Bridges',
            collapsed: false,
            items: [
              { text: 'Comparison', link: '/guide/runtimes/comparison' },
              { text: 'Node.js', link: '/guide/runtimes/node' },
              { text: 'Bun', link: '/guide/runtimes/bun' },
              { text: 'Deno', link: '/guide/runtimes/deno' },
              { text: 'Browser (Pyodide)', link: '/guide/runtimes/browser' },
              { text: 'HTTP Bridge', link: '/guide/runtimes/http' },
            ],
          },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Environment Variables', link: '/reference/env-vars' },
          { text: 'Type Mapping', link: '/reference/type-mapping' },
          { text: 'API', link: '/reference/api/' },
        ],
      },
      {
        text: 'Examples',
        items: [
          { text: 'Quick Examples', link: '/examples/' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/troubleshooting/' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bbopen/tywrap' },
    ],

    editLink: {
      pattern: 'https://github.com/bbopen/tywrap/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © tywrap contributors',
    },
  },
})
