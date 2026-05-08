import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

function mergeClasses(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(' ')
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className, isLoading, variant = 'primary', size = 'md', disabled, ...props },
  ref,
) {
  // Add click effect (active:scale-[0.97]) and transition-all for global smooth interactions
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-150 ease-out focus:outline-none disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97] rounded-md'
  
  // Dark mode styling, very dim backgrounds, thin borders that pop
  const variantClasses = {
    primary: 'bg-slate-800/40 text-slate-200 border border-slate-600/50 hover:bg-slate-800/70 hover:border-slate-500 shadow-sm',
    secondary: 'bg-slate-900/60 text-slate-300 border border-slate-700/60 hover:bg-slate-800/60 hover:border-slate-600 shadow-sm',
    danger: 'bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-900/50 hover:border-red-800 shadow-sm',
    ghost: 'bg-transparent text-slate-400 border border-transparent hover:text-slate-200 hover:bg-slate-800/40',
  }

  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 gap-2',
    md: 'text-[13px] px-4 py-2 gap-2',
    lg: 'text-sm px-5 py-2.5 gap-2',
  }

  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={mergeClasses(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {isLoading ? (
        <div className="flex items-center justify-center gap-2">
          <svg
            className="animate-spin h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            style={{ minWidth: '16px', minHeight: '16px' }}
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-100"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <span className="opacity-90 truncate">{children}</span>
        </div>
      ) : (
        children
      )}
    </button>
  )
})
