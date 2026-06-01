import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

// FB1: a single ⌘K command surface. The global CommandPalette is the one palette
// in the app. Views that have contextual actions (today: the AI workspace —
// message actions, new chat, model picker, chat settings) PUBLISH them here, and
// the palette reads them. This replaces the separate in-chat ChatActionPalette
// without moving chat state out of the AI view: the actions' `perform` closures
// still live in the view that owns the state.

export type CommandSurfaceGroup = 'message' | 'chat'

export interface CommandSurfaceAction {
  id: string
  group: CommandSurfaceGroup
  label: string
  hint?: string
  accelerator?: string
  keywords?: string
  icon?: ReactNode
  perform: () => void | Promise<void>
}

interface CommandSurfaceState {
  actions: CommandSurfaceAction[]
}

let state: CommandSurfaceState = { actions: [] }
const listeners = new Set<() => void>()
let opener: (() => void) | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

/** Publish the current view's contextual actions into the palette. */
export function setCommandSurfaceActions(actions: CommandSurfaceAction[]): void {
  state = { actions }
  emit()
}

/** Drop this view's contextual actions (call on unmount / when leaving the view). */
export function clearCommandSurfaceActions(): void {
  if (state.actions.length === 0) return
  state = { actions: [] }
  emit()
}

function getSnapshot(): CommandSurfaceState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Read the published contextual actions (re-renders the palette on change). */
export function useCommandSurfaceActions(): CommandSurfaceAction[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).actions
}

/** App.tsx registers how to open the one palette; any view can call openCommandPalette(). */
export function registerCommandPaletteOpener(fn: () => void): () => void {
  opener = fn
  return () => { if (opener === fn) opener = null }
}

export function openCommandPalette(): void {
  opener?.()
}
