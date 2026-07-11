/**
 * Lets a page place its own title (any node, e.g. inline-editable text)
 * into the primary nav, in place of the app title. The shell renders a
 * slot element; <ShellTitle> portals its children into it and flips an
 * `active` flag the shell uses to hide the brand text. A portal (not
 * state) carries the content, so page re-renders can't loop the shell.
 * Without a provider (unit tests), children render inline as a fallback.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

interface ShellTitleContextValue {
  slot: HTMLElement | null
  setSlot: (el: HTMLElement | null) => void
  active: boolean
  setActive: (active: boolean) => void
}

const ShellTitleContext = createContext<ShellTitleContextValue | null>(null)

export function ShellTitleProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [active, setActive] = useState(false)
  return (
    <ShellTitleContext.Provider value={{ slot, setSlot, active, setActive }}>
      {children}
    </ShellTitleContext.Provider>
  )
}

/** Consumed by the shells to host the slot and hide the brand text. */
export const useShellTitleSlot = () => useContext(ShellTitleContext)

/** Rendered by a page to place `children` into the primary nav. */
export function ShellTitle({ children }: { children: ReactNode }) {
  const ctx = useContext(ShellTitleContext)
  const setActive = ctx?.setActive

  useEffect(() => {
    if (!setActive) return
    setActive(true)
    return () => setActive(false)
  }, [setActive])

  if (!ctx?.slot) return <>{children}</>
  return createPortal(children, ctx.slot)
}
