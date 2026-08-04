/**
 * Open/closed state for the primary-nav drawer, shared between the toggle
 * button in the header (ShellMenu) and the frame that shifts the page.
 *
 * Opening the drawer pushes the whole shell to the right rather than
 * covering it, so the shift has to wrap everything the shells render while
 * the button that triggers it sits deep inside the header. The state lives
 * here so both ends can reach it.
 */
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'

/** How far the page moves aside — the drawer panel's own width. The pixel
 * value is the same distance, for arithmetic on shifted layout boxes. */
export const DRAWER_WIDTH = 'w-64'
export const DRAWER_PX = 256
const DRAWER_SHIFT = 'translate-x-64'

type DrawerState = [boolean, Dispatch<SetStateAction<boolean>>]

const ShellDrawerContext = createContext<DrawerState | null>(null)

/**
 * The shell's drawer state. Falls back to private state when there is no
 * frame above it, so a bare ShellMenu still opens and closes on its own.
 */
export function useShellDrawer(): DrawerState {
  const local = useState(false)
  return useContext(ShellDrawerContext) ?? local
}

/**
 * Wraps a shell's content in the layer that slides sideways when the drawer
 * opens. The panel itself is not in here: ShellMenu renders it into the
 * body so it stays put while this layer moves.
 */
export function ShellDrawerFrame({ children }: { children: ReactNode }) {
  const state = useState(false)
  const [open] = state
  return (
    <ShellDrawerContext.Provider value={state}>
      {/* Clipped, not hidden: `overflow-x: hidden` would turn this into a
          scroll container and strand the sticky header inside it. */}
      <div className="overflow-x-clip">
        {/* Closed carries no translate at all, rather than a `translate-x-0`
            that resolves to `translate: 0`. Any translate other than `none`
            makes this layer the containing block for every `position: fixed`
            descendant inside it, which positions them against the document
            instead of the viewport — the dragged deck toolbar landed a whole
            scroll offset above the window. Dropping the class still animates:
            `translate` interpolates from `none` as the identity. */}
        <div
          className={`transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? DRAWER_SHIFT : ''
          }`}
        >
          {children}
        </div>
      </div>
    </ShellDrawerContext.Provider>
  )
}
