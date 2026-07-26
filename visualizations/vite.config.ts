import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this repo at https://<user>.github.io/system-design-notes/
// and this app is deployed to the /visualizations/ subpath within it, so asset
// URLs need that base path baked in at build time.
export default defineConfig({
  plugins: [react()],
  base: "/system-design-notes/visualizations/",
});
