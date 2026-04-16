import { useEffect } from 'react'

interface KeyBinding {
  key: string
  action: () => void
  /** If true, binding fires even when an input is focused */
  global?: boolean
}

/**
 * Registers keyboard event listeners on the document.
 * Bindings are disabled when an input/textarea/select is focused (unless `global` is set).
 * Uses `event.key` checks — no keyCode.
 */
export function useKeyboardNav(bindings: KeyBinding[], deps: unknown[] = []) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Skip if a modifier key is held (Ctrl/Alt/Meta) to avoid conflicting with system shortcuts
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select'
      const contentEditable = (e.target as HTMLElement)?.isContentEditable

      for (const binding of bindings) {
        if (e.key === binding.key) {
          if (!binding.global && (isInput || contentEditable)) continue
          e.preventDefault()
          binding.action()
          return
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
