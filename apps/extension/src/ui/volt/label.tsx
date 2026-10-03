import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Shared label styling. Prefer a native `<label htmlFor={id} className={labelClassName}>`
 * over a `<Label>` wrapper component: a11y linters can only verify the
 * label↔control association when the `htmlFor` is visible at the call site, not
 * hidden inside a forwarding primitive. Merge extra classes with `cn(labelClassName, …)`.
 *
 * Compact density — text-[12px] not text-sm. The label sits above a h-8 Input;
 * text-sm makes the label taller than the input it labels, which reads as
 * misaligned vertical rhythm. NO select-none (removed 2026-07-08, user callout):
 * the stock basecn default made every label uncopyable app-wide.
 */
export const labelClassName =
	"flex items-center gap-2 text-[12px] leading-none font-medium group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50  peer-[[data-disabled]]:opacity-50"

function Label({
	className,
	htmlFor,
	children,
	...props
}: React.ComponentProps<"label">) {
	return (
		<label
			htmlFor={htmlFor}
			data-slot="label"
			className={cn(labelClassName, className)}
			{...props}
		>
			{children}
		</label>
	)
}

export { Label }
