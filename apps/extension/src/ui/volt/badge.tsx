import type * as React from "react"
import { cn } from "@/lib/utils"

const tones: Record<string, string> = {
	default: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100",
	active:
		"bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
	draft: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	archived: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
}

export function Badge({
	tone = "default",
	className,
	...props
}: React.ComponentProps<"span"> & { tone?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
				tones[tone] ?? tones.default,
				className,
			)}
			{...props}
		/>
	)
}
