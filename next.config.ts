import type { NextConfig } from "next";
import { REMOVED_PAGES } from "./src/lib/removedPages";

const nextConfig: NextConfig = {
  // Electronパッケージ配布用に、node_modulesを含む自己完結サーバーを.next/standaloneへ出力する
  output: "standalone",
  // ⑬ でやめたページは、行き先のページへ移す(404 にしない)
  async redirects() {
    return REMOVED_PAGES.map(({ source, destination }) => ({ source, destination, permanent: false }));
  },
};

export default nextConfig;
