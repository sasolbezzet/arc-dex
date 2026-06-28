import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  className?: string
  preferredWidth?: number
}

export function ViewportPopover({ open, anchorRef, onClose, children, className = '', preferredWidth = 180 }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8, width: preferredWidth })

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return
      const gutter = 8
      const width = Math.min(Math.max(anchor.width, preferredWidth), window.innerWidth - gutter * 2)
      const height = panelRef.current?.offsetHeight || 240
      const left = Math.min(Math.max(gutter, anchor.left), window.innerWidth - width - gutter)
      const below = anchor.bottom + 6
      const top = below + height <= window.innerHeight - gutter
        ? below
        : Math.max(gutter, anchor.top - height - 6)
      setPosition({ left, top, width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef, open, preferredWidth])

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !panelRef.current?.contains(target)) onClose()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchorRef, onClose, open])

  if (!open) return null
  return createPortal(
    <div
      ref={panelRef}
      className={`viewport-popover ${className}`.trim()}
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      {children}
    </div>,
    document.body,
  )
}
