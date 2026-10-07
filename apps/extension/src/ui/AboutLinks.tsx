import { PROJECT_LINKS } from '@/core/constants';

/** One outbound link: always a new tab, never passing this page as referrer or opener. */
function Out(props: { readonly href: string; readonly children: React.ReactNode }) {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
      {props.children}
    </a>
  );
}

/**
 * Who makes Tabsona and where to get help: khanakia.com, the docs, GitHub, issues.
 *
 * Shown at the foot of the library page and under the popup's guide, so "where do I learn
 * more or report a problem" always has an answer one click away.
 */
export function AboutLinks(props: { readonly compact?: boolean }) {
  const sep = <span aria-hidden> · </span>;
  return (
    <p className="text-[11px] text-muted-foreground">
      {!props.compact && <>Tabsona by Aman Bansal{sep}</>}
      <Out href={PROJECT_LINKS.website}>khanakia.com</Out>{sep}
      <Out href={PROJECT_LINKS.docs}>Help &amp; how it works</Out>{sep}
      <Out href={PROJECT_LINKS.issues}>Report a problem</Out>
      {!props.compact && <>{sep}<Out href={PROJECT_LINKS.github}>GitHub</Out>{sep}<Out href={PROJECT_LINKS.apps}>More tools</Out></>}
    </p>
  );
}
