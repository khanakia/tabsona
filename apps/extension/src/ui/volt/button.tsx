import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
	{
		variants: {
			variant: {
				// Polaris-grade primary: flat black, no drop shadow, slight
				// active-press for tactile feedback.
				default:
					"bg-primary text-primary-foreground hover:bg-primary/90 active:translate-y-px",
				destructive:
					"bg-destructive text-white hover:bg-destructive/90 active:translate-y-px focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
				// Outline frame + red text — the "soft delete" affordance used for
				// row/inline destructive actions (Delete in a list). Reads as a
				// sibling of `outline`, not the heavy solid-red `destructive`.
				"destructive-outline":
					"border border-input bg-background text-destructive hover:bg-destructive/10 hover:text-destructive active:translate-y-px dark:bg-input/30 dark:border-input",
				// Outline: flat 1px border + white bg. Reads as a clickable
				// surface via the visible frame, no shadow needed.
				outline:
					"border border-input bg-background text-foreground hover:bg-muted hover:text-foreground active:translate-y-px dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80 active:translate-y-px",
				ghost:
					"text-foreground/80 hover:bg-muted hover:text-foreground dark:hover:bg-accent/50",
				link: "text-primary underline-offset-4 hover:underline",
			},
			// Polaris-grade density. Polaris's *actual* default Button in their
			// docs renders at 28px / 12px / font-weight 500 / rounded-lg — that
			// reads as "slim" against shadcn's chunky 36px h-9 default. We
			// promote that to project default. The h-7 height was right; the
			// missing piece was `font-medium` (Polaris weight) — without it,
			// buttons read anemic at this height.
			size: {
				// DEFAULT — Polaris "slim/default": 28px · 12px · medium · rounded-lg.
				// Height + text read from the shared control-density tokens so the
				// default button always lines up with inputs/selects in a toolbar.
				default:
					"h-(--control-height) rounded-lg gap-1.5 px-3 text-(length:--control-font-size) font-medium has-[>svg]:px-2.5 [&_svg]:size-3.5",
				// xs — table-row actions / filter chips. 24px.
				xs: "h-6 rounded-md gap-1 px-2 text-[11px] font-medium has-[>svg]:px-1.5 [&_svg]:size-3",
				// sm — alias of default; existing call sites keep working.
				sm: "h-(--control-height) rounded-lg gap-1.5 px-3 text-(length:--control-font-size) font-medium has-[>svg]:px-2.5 [&_svg]:size-3.5",
				// md — Polaris "medium", for page-header CTAs that need to stand out.
				md: "h-8 rounded-lg gap-1.5 px-3.5 text-[13px] font-medium has-[>svg]:px-3 [&_svg]:size-4",
				// lg — full-width form CTAs (login / set-password).
				lg: "h-9 rounded-lg px-4 text-[13px] font-medium has-[>svg]:px-3.5 [&_svg]:size-4",
				// Square icon-only buttons. `icon` matches the control height token.
				icon: "size-(--control-height) [&_svg]:size-3.5",
				"icon-sm": "size-6 [&_svg]:size-3",
				"icon-md": "size-8 [&_svg]:size-4",
				"icon-lg": "size-9 [&_svg]:size-4",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

type ButtonProps = ButtonPrimitive.Props &
	VariantProps<typeof buttonVariants> & {
		ref?: React.RefObject<HTMLButtonElement | null>
	}

function Button({ className, variant, size, ...props }: ButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	)
}

export { Button, buttonVariants }
