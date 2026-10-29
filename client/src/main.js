import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { applyTheme } from './browser/prefs.js'

applyTheme()
createApp(App).mount('#app')

// PWA: funciona offline e pode ser instalado (so no build de producao)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
