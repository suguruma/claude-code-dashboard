/**
 * cytoscape 3.30.2 の、⑲ 全体マップが使う分だけの型(3.30 は型を同梱しない。@types を足さずに、使う所だけを書く)
 */
declare module "cytoscape" {
  export interface Position {
    x: number
    y: number
  }

  export interface ElementDefinition {
    group?: "nodes" | "edges"
    data: Record<string, unknown> & { id?: string; source?: string; target?: string }
    position?: Position
    classes?: string
  }

  export interface Collection {
    length: number
    addClass(c: string): Collection
    removeClass(c: string): Collection
    toggleClass(c: string, on?: boolean): Collection
    hasClass(c: string): boolean
    filter(selector: string | ((el: SingularElement) => boolean)): Collection
    forEach(fn: (el: SingularElement) => void): void
    union(other: Collection): Collection
    difference(other: Collection | string): Collection
    connectedEdges(selector?: string): Collection
    neighborhood(selector?: string): Collection
    closedNeighborhood(selector?: string): Collection
    nodes(selector?: string): Collection
    edges(selector?: string): Collection
    style(name: string, value: unknown): Collection
    boundingBox(opts?: Record<string, unknown>): { x1: number; y1: number; x2: number; y2: number; w: number; h: number }
  }

  export interface SingularElement extends Collection {
    id(): string
    data(key?: string): unknown
    position(): Position
    isNode(): boolean
  }

  export interface EventObject {
    target: SingularElement | Core
  }

  export interface Core {
    add(els: ElementDefinition[]): Collection
    elements(selector?: string): Collection
    nodes(selector?: string): Collection
    edges(selector?: string): Collection
    getElementById(id: string): SingularElement
    zoom(): number
    zoom(level: number | { level: number; position?: Position; renderedPosition?: Position }): void
    pan(): Position
    pan(p: Position): void
    minZoom(z?: number): number
    maxZoom(z?: number): number
    fit(eles?: Collection, padding?: number): void
    center(eles?: Collection): void
    width(): number
    height(): number
    animate(opts: Record<string, unknown>): void
    stop(clearQueue?: boolean, jumpToEnd?: boolean): void
    style(sheet?: unknown): { update(): void }
    on(events: string, selectorOrHandler: string | ((e: EventObject) => void), handler?: (e: EventObject) => void): void
    batch(fn: () => void): void
    resize(): void
    destroy(): void
    destroyed(): boolean
  }

  export interface CytoscapeOptions {
    container: HTMLElement
    elements?: ElementDefinition[]
    style?: unknown
    layout?: { name: string; [key: string]: unknown }
    minZoom?: number
    maxZoom?: number
    userZoomingEnabled?: boolean
    userPanningEnabled?: boolean
    boxSelectionEnabled?: boolean
    autoungrabify?: boolean
    autounselectify?: boolean
  }

  export default function cytoscape(options: CytoscapeOptions): Core
}
