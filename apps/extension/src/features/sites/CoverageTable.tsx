import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/volt/table';
import { shortSite } from '@/ui/format';
import type { OriginCoverage } from '@/domain/messages';
import type { CoverageStatus } from '@/domain/types';

/**
 * Per-origin isolation report. Presentational: props in, nothing out.
 *
 * Where "why does this site say leaking?" is answered properly, with the per-layer
 * reason a popup chip has no room for.
 */
const STATUS_COLOR: Record<CoverageStatus, string> = {
  covered: 'var(--state-signed-in)',
  leaking: 'var(--state-expired)',
  unknown: 'var(--state-empty)',
  'not-applicable': 'var(--muted-foreground)',
  shared: 'var(--muted-foreground)',
};

export function CoverageTable(props: { readonly report: readonly OriginCoverage[] }) {
  if (props.report.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing observed yet. Open a site in a persona and this fills in with what was
        actually measured — not what was assumed.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {props.report.map((entry) => (
        <section key={entry.origin}>
          <h3 className="mb-1.5 font-mono text-xs font-semibold">{shortSite(entry.origin)}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Layer</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.coverage.map((c) => (
                <TableRow key={c.layer}>
                  <TableCell className="font-medium">{c.layer}</TableCell>
                  <TableCell className="font-semibold" style={{ color: STATUS_COLOR[c.status] }}>
                    {c.status}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
