import { ACTION_HELP } from './help';
import { AboutLinks } from './AboutLinks';

/**
 * The three steps, for someone opening Tabsona for the first time.
 *
 * Shown automatically while there are no personas, and on demand from the header's "?"
 * afterwards. Names the real button labels from ACTION_HELP, so the guide cannot point at
 * a control that has since been renamed.
 */
export function HowItWorks() {
  const steps: readonly { readonly title: string; readonly body: string }[] = [
    {
      title: `Make a persona`,
      body: `Press + at the top and give it a name, like “Acme admin”. A persona is one identity with its own logins.`,
    },
    {
      title: 'Sign in once',
      body: `Go to a website and sign in as usual. Then choose “${ACTION_HELP.addToPersona.label}” at the bottom of this window.`,
    },
    {
      title: 'Open it any time',
      body: `“${ACTION_HELP.openAll.label}” opens every website in the persona, each in its own tab, already signed in. Its tabs never mix with your normal browser login.`,
    },
  ];
  return (
    <div className="space-y-2 px-3 py-3">
      <ol className="space-y-2 text-xs">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-2">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span>
              <span className="font-medium">{step.title}. </span>
              <span className="text-muted-foreground">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="pl-6"><AboutLinks compact /></div>
    </div>
  );
}
