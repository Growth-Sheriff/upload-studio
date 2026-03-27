import measurePreflightWorker from './measure-preflight.worker'
import previewRenderWorker from './preview-render.worker'

console.log('[Preflight Worker Bootstrap] Measure and preview workers loaded.')

export { measurePreflightWorker, previewRenderWorker }

export default {
  measurePreflightWorker,
  previewRenderWorker,
}
