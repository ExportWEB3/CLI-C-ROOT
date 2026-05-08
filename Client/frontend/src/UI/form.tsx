import { forwardRef } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

function mergeClasses(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(' ')
}

const baseFieldClassName =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-brand-500'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={mergeClasses(baseFieldClassName, className)} {...props} />
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={mergeClasses(
        'w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-200 outline-none',
        className,
      )}
      {...props}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={mergeClasses(baseFieldClassName, className)} {...props} />
})

export const Dropdown = Select

export interface FieldLabelProps {
  label: string
  className?: string
  children: React.ReactNode
}

export function FieldLabel({ label, className, children }: FieldLabelProps) {
  return (
    <label className={mergeClasses('flex flex-col gap-2 text-sm text-slate-300', className)}>
      <span>{label}</span>
      {children}
    </label>
  )
}
