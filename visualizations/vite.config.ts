import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project site: https://<user>.github.io/<repo-name>/
// The workflow uploads visualizations/dist as the site root, so Vite's base
// must match the repo name, not a /visualizations/ folder on the host.
export default defineConfig({
  plugins: [react()],
  base: "/system-design-notes/",
});
