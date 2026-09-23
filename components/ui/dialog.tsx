import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
}

export function Dialog({ isOpen, onClose, title, description, children, footer }: DialogProps) {
  const modalRef = React.useRef<HTMLDivElement>(null)
  const touchStartY = React.useRef<number>(0)

  React.useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    // Lock body scroll while dialog is open
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  // Swipe-to-dismiss on mobile — downward swipe on the backdrop
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    // Dismiss if swiped down more than 80px
    if (deltaY > 80) {
      onClose()
    }
  }

  React.useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const titleId = "dialog-title"
  const descId = description ? "dialog-description" : undefined

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/50 dark:bg-zinc-950/70 backdrop-blur-md animate-in fade-in duration-300"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={cn(
          // select-text: the app-shell roots carry `select-none` (chrome
          // drag-guard); on iOS Safari that inherited value also blocks
          // focus/caret inside inputs — modal surfaces must re-enable it.
          "w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 focus:outline-none relative group select-text",
          "bg-white dark:bg-zinc-950 border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 rounded-2xl shadow-2xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn(
          "px-6 py-5 flex items-center justify-between relative z-10",
          "border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-bone"
        )}>
          <h3
            id={titleId}
            className="text-base font-semibold tracking-tight text-ink"
          >{title}</h3>
          <button
            onClick={onClose}
            className={cn(
              "transition-colors focus:outline-none p-1",
              "text-ink/50 hover:text-[var(--app-accent)]"
            )}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 relative z-10">
          {description && <p id={descId} className={cn(
            "mb-4 leading-relaxed",
            "text-sm text-ink/60"
          )}>{description}</p>}
          {children}
        </div>

        {footer && (
          <div className={cn(
            "px-6 py-4 flex justify-end gap-3 relative z-10",
            "border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-black/[0.02]"
          )}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

interface AlertDialogProps {
  isOpen: boolean
  title: string
  description: string
  cancelLabel?: string
  actionLabel?: string
  onCancel: () => void
  onAction: () => void
  variant?: 'default' | 'destructive'
}

export function AlertDialog({ 
  isOpen, 
  title, 
  description, 
  cancelLabel = "Cancel", 
  actionLabel = "Continue", 
  onCancel, 
  onAction,
  variant = 'default'
}: AlertDialogProps) {
  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onCancel} 
      title={title}
      footer={
        <>
          <Button 
            type="button"
            variant="ghost" 
            size="sm" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }} 
            className="text-xs font-semibold tracking-tight text-ink/60 hover:text-ink"
          >
            {cancelLabel}
          </Button>
          <Button 
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'default'} 
            size="sm" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAction();
              onCancel();
            }}
            className="text-xs font-semibold tracking-tight px-6"
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">{description}</p>
    </Dialog>
  )
}
