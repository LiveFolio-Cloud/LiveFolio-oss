import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'glass'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const v2Variants = {
      default: "bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent)]/90",
      destructive: "bg-red-600 text-white hover:bg-red-700",
      outline: "border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent text-ink hover:bg-black/5",
      secondary: "bg-black/5 text-ink hover:bg-black/10",
      ghost: "text-ink/70 hover:text-ink hover:bg-black/5",
      link: "text-[var(--app-accent)] underline-offset-4 hover:underline",
      glass: "border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-white/90 text-ink backdrop-blur",
    }
    const v2Sizes = {
      default: "h-10 px-5 py-2",
      sm: "h-9 px-3",
      lg: "h-12 px-8",
      icon: "h-10 w-10",
    }
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          v2Variants[variant],
          v2Sizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
