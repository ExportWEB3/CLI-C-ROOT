import type { ReactNode, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'

function mergeClasses(...classes: Array<string | undefined | false | null>) {
	return classes.filter(Boolean).join(' ')
}

interface TableContainerProps {
	children: ReactNode
	className?: string
}

export function TableContainer({ children, className }: TableContainerProps) {
	return <div className={mergeClasses('overflow-x-auto rounded-lg border border-slate-800 main-scrollbar', className)}>{children}</div>
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
	return <table className={mergeClasses('min-w-full text-left text-xs', className)} {...props} />
}

export function TableHead({ className, ...props }: TableHTMLAttributes<HTMLTableSectionElement>) {
	return <thead className={mergeClasses('bg-slate-900/80 text-slate-300', className)} {...props} />
}

export function TableBody({ className, ...props }: TableHTMLAttributes<HTMLTableSectionElement>) {
	return <tbody className={mergeClasses('divide-y divide-slate-800 bg-slate-950/40 text-slate-200', className)} {...props} />
}

export function TableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
	return <th className={mergeClasses('px-3 py-2 font-medium whitespace-nowrap', className)} {...props} />
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
	return <td className={mergeClasses('px-3 py-2 whitespace-nowrap', className)} {...props} />
}

