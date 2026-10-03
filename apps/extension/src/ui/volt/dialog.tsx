import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"
import type * as React from "react"
import { Button } from "@/ui/volt/button"
import { cn } from "@/lib/utils"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	// base-ui drives transitions through `data-starting-style` and
	// `data-ending-style` markers. We use CSS transitions (not
	// tailwindcss-animate keyframes) — keyframe animations don't compose with
	// base-ui's marker lifecycle and produce a visible black-overlay flash on
	// close. Plain `transition-opacity` + opacity-0 markers are reliable.
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
				className,
			)}
			{...props}
		/>
	)
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: Omit<DialogPrimitive.Popup.Props, "children"> & {
	children?: React.ReactNode
	showCloseButton?: boolean
}) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				// Polaris-grade modal: 3-zone structure where DialogHeader
				// and DialogFooter draw their OWN padding + separator
				// borders. The content surface itself is padding-less; the
				// header/footer/body each control their own space. Inner
				// `flex flex-col` so the 3 zones stack and the footer can
				// stick to the bottom even with tall body content.
				className={cn(
					"fixed top-[50%] left-[50%] z-50 flex w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg outline-none transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 sm:max-w-[400px]",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						className="absolute top-2.5 right-2.5 cursor-pointer rounded p-1 text-muted-foreground opacity-80 hover:bg-muted/60 hover:opacity-100 focus:outline-none disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
					>
						<XIcon />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	)
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			// Polaris-grade header bar: own padding, bottom border, leaves
			// space at the right for the absolute X close (pr-8).
			className={cn(
				"flex flex-col gap-0.5 border-b border-border px-4 py-3 pr-8 text-left",
				className,
			)}
			{...props}
		/>
	)
}

// DialogBody — the content area between header and footer. Owns its own
// padding so the page-level form can stay clean of repetitive `p-4`
// wrappers. Use this around any form fields / descriptive content
// inside a Dialog.
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-body"
			className={cn("px-4 py-3.5", className)}
			{...props}
		/>
	)
}

function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean
}) {
	return (
		<div
			data-slot="dialog-footer"
			// Polaris-grade footer: own padding, top border + subtle muted
			// background so the actions visually anchor at the bottom of
			// the modal. Right-aligned actions, gap-2 between them.
			className={cn(
				"flex flex-row justify-end gap-2 border-t border-border bg-muted/50 px-4 py-2.5",
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close
					render={<Button variant="outline">Close</Button>}
				/>
			)}
		</div>
	)
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			// Polaris title: text-[15px] semibold. Substantial enough to
			// own the header bar without shouting.
			className={cn("text-[15px] leading-tight font-semibold", className)}
			{...props}
		/>
	)
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-[11px] text-muted-foreground", className)}
			{...props}
		/>
	)
}

export {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
}
