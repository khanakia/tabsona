import { Input as InputPrimitive } from "@base-ui/react/input"
import type * as React from "react"

import { cn } from "@/lib/utils"

function Input({
	className,
	type,
	...props
}: InputPrimitive.Props & React.RefAttributes<HTMLInputElement>) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			// Plain flat input: 1px uniform border, NO shadow, NO inset-depth
			// trick. Visually quiet so the focus state (1px ring tighten) is
			// the only emphasis. Rounded-md (6px) matches the project radius.
			className={cn(
				"file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input dark:bg-input/30 flex h-(--control-height) w-full min-w-0 rounded-md border bg-background px-(--control-padding-x) py-0.5 text-(length:--control-font-size) transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				"focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring",
				"aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/30",
				className,
			)}
			{...props}
		/>
	)
}

export { Input }
