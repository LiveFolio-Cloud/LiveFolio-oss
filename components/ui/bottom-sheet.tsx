"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
}

export function BottomSheet({ isOpen, onClose, title, description, children, footer }: BottomSheetProps) {
  const sheetRef = React.useRef<HTMLDivElement>(null)
  const touchStartY = React.useRef<number>(0)
  const [translateY, setTranslateY] = React.useState(0)

  React.useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  // Reset translateY when opening
  React.useEffect(() => {
    if (isOpen) {
      setTranslateY(0)
    }
  }, [isOpen])

  // Touch handlers for swipe-to-dismiss on mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const deltaY = e.touches[0].clientY - touchStartY.current
    if (deltaY > 0) {
      setTranslateY(deltaY)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    if (deltaY > 100) {
      onClose()
    }
    setTranslateY(0)
  }

  React.useEffect(() => {
    if (isOpen && sheetRef.current) {
      sheetRef.current.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const titleId = "bottomsheet-title"
  const descId = description ? "bottomsheet-description" : undefined

  // Desktop: centered dialog (same as existing Dialog)
  // Mobile: bottom sheet that slides up from the bottom
  return (
    <div
      className="fixed inset-0 z-[100] bg-[#0F0F0D]/50 dark:bg-[#0F0F0D]/70 backdrop-blur-sm animate-in fade-in duration-300"
      onClick={onClose}
    >
      {/* Desktop layout: centered dialog */}
      <div className="hidden lg:flex items-center justify-center w-full h-full p-4">
        <div
          ref={sheetRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className={cn(
            "w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 focus:outline-none relative group",
            "bg-white dark:bg-zinc-950 rounded-2xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 shadow-2xl"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={cn(
            "px-6 py-5 flex items-center justify-between relative z-10",
            "border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-bone"
          )}>
            <h3 id={titleId} className={cn(
              "text-base font-semibold tracking-tight",
              "text-ink"
            )}>{title}</h3>
            <button
              onClick={onClose}
              className={cn(
                "transition-colors focus:outline-none p-1 min-h-[44px] min-w-[44px] flex items-center justify-center",
                "rounded-lg text-ink/60 hover:text-[var(--app-accent)] hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40"
              )}
              aria-label="Close dialog"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-6 relative z-10 max-h-[70vh] overflow-y-auto">
            {description && <p id={descId} className="text-[13px] text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 mb-4 leading-relaxed">{description}</p>}
            {children}
          </div>

          {footer && (
            <div className="px-6 py-4 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/5 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 flex justify-end gap-3 relative z-10">
              {footer}
            </div>
          )}
        </div>
      </div>

      {/* Mobile layout: bottom sheet */}
      <div
        className="lg:hidden absolute bottom-0 left-0 right-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={sheetRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className={cn(
            "w-full max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-300 focus:outline-none",
            "bg-white dark:bg-[#171714] rounded-t-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          )}
          style={{ transform: `translateY(${translateY}px)` }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#0F0F0D]/15 dark:bg-[#F4F4F0]/20" />
          </div>

          <div className={cn(
            "px-5 py-4 flex items-center justify-between relative z-10",
            "border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10"
          )}>
            <h3 id={titleId} className="text-base font-bold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">{title}</h3>
            <button
              onClick={onClose}
              className={cn(
                "transition-colors focus:outline-none p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center",
                "rounded-lg text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FF3B00]/40"
              )}
              aria-label="Close dialog"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-5 relative z-10 overflow-y-auto max-h-[60vh]">
            {description && <p id={descId} className="text-[13px] text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 mb-4 leading-relaxed">{description}</p>}
            {children}
          </div>

          {footer && (
            <div className="px-5 py-4 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/5 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 flex justify-end gap-3 relative z-10">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
