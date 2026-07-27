import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electronパッケージ配布用に、node_modulesを含む自己完結サーバーを.next/standaloneへ出力する
  output: "standalone",
};

export default nextConfig;
