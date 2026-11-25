import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // The emulators and README assume port 3000: fail if it's taken rather than move to another port.
  server: { port: 3000, strictPort: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  // Local embeddings use native ONNX bindings: load them from node_modules, don't bundle them.
  ssr: { external: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'] },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})

export default config
