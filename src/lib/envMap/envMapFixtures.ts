/** ⑲ の試験用の合成の地図(実際の箱の名前・置き場は含まない) */

const LAYERS = ["entry", "safety", "routing", "skills", "tools", "knowledge", "output"].map((id) => ({ id, label: `層${id}` }))

/** 合成の地図(schema 1・7層・箱105〈うち ghost 11〉・線69〈うち食い違い1〉) */
export function syntheticMap(overrides: Record<string, unknown> = {}) {
  const nodes: Record<string, unknown>[] = []
  for (let i = 0; i < 105; i++) {
    const layer = LAYERS[i % 7].id
    nodes.push({ id: `${layer}:n${i}`, layer, label: `箱${i}`, kind: "種類", strength: "none", place: "", desc: "", ...(i >= 94 ? { ghost: true } : {}) })
  }
  const edges: Record<string, unknown>[] = []
  for (let i = 0; i < 69; i++) {
    edges.push({ src: nodes[i].id, dst: nodes[(i + 1) % 94].id, kind: i === 0 ? "conflict" : "mention", label: "使う", origin: "", note: "" })
  }
  return { schema: 1, generated_at: "2026-11-18 09:41", layers: LAYERS, nodes, edges, ...overrides }
}
