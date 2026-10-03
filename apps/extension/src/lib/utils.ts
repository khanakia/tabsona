import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes so a later class wins over an earlier conflicting one.
 *  Same helper volt-web uses, kept byte-identical so copied components work unchanged. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
