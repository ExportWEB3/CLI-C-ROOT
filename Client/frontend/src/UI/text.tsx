import type { ReactNode } from 'react'

function mergeClasses(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(' ')
}

interface TextProps {
  children: ReactNode
  className?: string
}

export function Heading({ children, className }: TextProps) {
  return <h3 className={mergeClasses('text-base font-semibold text-slate-100', className)}>{children}</h3>
}

export function SectionTitle({ children, className }: TextProps) {
  return <p className={mergeClasses('text-sm font-medium text-slate-300', className)}>{children}</p>
}

export function MutedText({ children, className }: TextProps) {
  return <p className={mergeClasses('text-sm text-slate-400', className)}>{children}</p>
}
