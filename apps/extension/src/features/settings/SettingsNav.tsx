import type { SettingsGroup } from '@/domain/messages';

/**
 * The Settings tab's section list: a sticky column on the left, a row of chips above the
 * cards under the `sm` breakpoint (640px). Presentational: it shows which card is
 * `active` and reports a click; scrolling and the URL hash are the host's business.
 */
export interface SettingsNavProps {
  readonly items: readonly { readonly id: SettingsGroup; readonly label: string }[];
  readonly active: SettingsGroup;
  readonly onSelect: (id: SettingsGroup) => void;
}

export function SettingsNav(props: SettingsNavProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur sm:top-4 sm:mx-0 sm:w-44 sm:shrink-0 sm:self-start sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
    >
      <ul className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
        {props.items.map((item) => {
          const current = item.id === props.active;
          return (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => props.onSelect(item.id)}
                className={`h-7 w-full whitespace-nowrap rounded-md px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  current
                    ? 'bg-primary/10 font-medium text-foreground sm:border-l-2 sm:border-primary sm:rounded-l-none'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
