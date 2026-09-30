import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The library is linked from ../ (file:..), so without this its imports of the
  // Capacitor packages would resolve to the parent's node_modules and load a
  // second copy of @capacitor/core, breaking plugin registration.
  resolve: { dedupe: ['@capacitor/core', '@capacitor-community/bluetooth-le'] },
});
