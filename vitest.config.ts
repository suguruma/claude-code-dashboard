import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // tsconfig の paths("@/*" → "src/*")と同じ。API ルート(src/app/api)を単体でテストするときの import 解決に使う
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
