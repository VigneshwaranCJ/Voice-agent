// Minimal typings for @met4citizen/talkinghead (MIT), covering only what RealisticAvatar uses.
declare module '@met4citizen/talkinghead' {
  export interface MorphTarget {
    realtime: number | null
    needsUpdate: boolean
    [k: string]: unknown
  }
  /** The bits of a three.js Object3D / Mesh that RealisticAvatar touches. */
  export interface SceneMaterial {
    name?: string
    color?: { set(c: string): { multiplyScalar(s: number): unknown } }
    /** colour texture; set to null to show the plain material colour */
    map?: unknown
    userData: Record<string, unknown>
    needsUpdate?: boolean
  }
  export interface SceneNode {
    name: string
    isMesh?: boolean
    material?: SceneMaterial | SceneMaterial[]
    traverse(fn: (o: SceneNode) => void): void
  }
  export class TalkingHead {
    constructor(node: HTMLElement, opt?: Record<string, unknown>)
    opt: Record<string, unknown> & { update: ((dt: number) => void) | null }
    mtAvatar: Record<string, MorphTarget>
    showAvatar(
      avatar: Record<string, unknown>,
      onprogress?: ((e: ProgressEvent) => void) | null,
      onpreprocess?: ((gltf: { scene: SceneNode }) => void) | null,
    ): Promise<void>
    setMood(mood: string): void
    setView(view: 'full' | 'mid' | 'upper' | 'head', opt?: Record<string, number>): void
    playGesture(name: string, dur?: number, mirror?: boolean, ms?: number): void
    stopGesture(ms?: number): void
    lookAt(x: number, y: number, t: number): void
    lookAtCamera(t: number): void
    makeEyeContact(t: number): void
    lookAhead(t: number): void
    start(): void
    stop(): void
    dispose(): void
  }
}
