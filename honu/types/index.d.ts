export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Prefs = { band: boolean; sound: boolean; plan: string }

declare module 'claude-code' {
  interface PluginState {
    honu: { limits: readonly Limit[]; now: number; prefs: Prefs; working: boolean; fill: number | null }
  }
}
