import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { WithHelp } from './HelpCard';
import type { ActionHelp } from './help';

/**
 * The ⓘ beside a title: rest on it, or tab to it, for a card explaining what that part
 * of Tabsona is for. Sized to sit inline with small headings.
 */
export function HelpIcon({ help }: { readonly help: ActionHelp }) {
  return (
    <WithHelp
      help={help}
      titled
      trigger={(
        <button
          type="button"
          aria-label={`About ${help.label}`}
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
    >
      <CircleHelp className="size-3.5" />
    </WithHelp>
  );
}

/**
 * How every section of the library page opens: its name, an ⓘ with the full explanation,
 * and one line of plain text. The same shape everywhere, so people learn where to look.
 */
export function SectionIntro(props: {
  readonly help: ActionHelp;
  /** The one-line summary under the title. Defaults to the explanation's first sentence. */
  readonly children?: ReactNode;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {props.help.label}
        <HelpIcon help={props.help} />
      </h2>
      <p className="text-xs text-muted-foreground">{props.children ?? props.help.what}</p>
    </div>
  );
}
