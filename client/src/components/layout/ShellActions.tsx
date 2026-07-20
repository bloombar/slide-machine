/**
 * Right-side companion to ShellTitle: lets a page place controls (e.g. the
 * deck viewer's view toggle and settings) into the primary nav's action
 * area. The shell renders a slot element; <ShellActions> portals its
 * children into it. Without a provider (unit tests) children render inline,
 * so the controls stay reachable. A portal (not state) carries the content,
 * so page re-renders can't loop the shell.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ShellActionsContextValue {
  slot: HTMLElement | null
  setSlot: (el: HTMLElement | null) => void
}

const ShellActionsContext = createContext<ShellActionsContextValue | null>(null)

export function ShellActionsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <ShellActionsContext.Provider value={{ slot, setSlot }}>
      {children}
    </ShellActionsContext.Provider>
  )
}

/** Consumed by the shells to host the slot element. */
export const useShellActionsSlot = () => useContext(ShellActionsContext)

/** Rendered by a page to place `children` into the nav's action area. */
export function ShellActions({ children }: { children: ReactNode }) {
  const ctx = useContext(ShellActionsContext)
  if (!ctx?.slot) return <>{children}</>
  return createPortal(children, ctx.slot)
}
