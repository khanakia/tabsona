import type * as React from "react"
import { cn } from "@/lib/utils"

export function Table({ className, ...props }: React.ComponentProps<"table">) {
	return (
		<div className="w-full overflow-x-auto">
			<table
				className={cn("w-full caption-bottom text-sm", className)}
				{...props}
			/>
		</div>
	)
}
export function THead(props: React.ComponentProps<"thead">) {
	return (
		<thead
			className="bg-muted/40 [&_tr]:border-b [&_tr]:border-border"
			{...props}
		/>
	)
}
export function TBody(props: React.ComponentProps<"tbody">) {
	return <tbody className="[&_tr:last-child]:border-0" {...props} />
}
export function TR({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			className={cn(
				"border-b border-border transition-colors hover:bg-muted/60",
				className,
			)}
			{...props}
		/>
	)
}
export function TH({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			className={cn(
				"h-11 px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
				className,
			)}
			{...props}
		/>
	)
}
export function TD({ className, ...props }: React.ComponentProps<"td">) {
	return <td className={cn("px-4 py-3 align-middle", className)} {...props} />
}

// shadcn-style aliases — the copied ServerDataTable imports these names.
export const TableHeader = THead
export const TableBody = TBody
export const TableRow = TR
export const TableHead = TH
export const TableCell = TD
