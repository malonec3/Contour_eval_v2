import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function repositoryBase(): string {
  const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
  return repository ? `/${repository}/` : "/";
}

export default defineConfig({
  base: repositoryBase(),
  plugins: [react()],
  build: {
    outDir: "dist-github",
    emptyOutDir: true,
  },
});
