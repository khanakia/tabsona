// IndexedDB database-name namespacing, as a pure installer.
//
// The page shim calls this with the page's real `IDBFactory.prototype` and
// `IDBDatabase.prototype`; tests call it with stubs. Taking the prototypes as arguments
// is what lets every rule below be checked without a browser and without mocking a
// module: the installer only ever touches what it was handed.
//
// Only DATABASE NAMES are translated. Object stores, indexes, keys and values live
// inside the namespaced database already, so everything an app does once a database is
// open behaves exactly as it wrote it. See docsi/SPEC_INDEXEDDB.md.

import { qualify, unqualify } from './namespace';
import type { SessionId } from '@/domain/types';

/** One entry of `indexedDB.databases()`. Both fields are optional in the platform type. */
export interface DatabaseInfoLike {
  readonly name?: string;
  readonly version?: number;
}

/**
 * The slice of `IDBFactory.prototype` the installer rewrites.
 *
 * Methods are declared with `this: unknown` so the real prototype is assignable without a
 * cast, and so the wrappers can forward the receiver untouched — calling the original on
 * the wrong receiver throws "Illegal invocation" in Chrome.
 */
export interface IdbFactoryProto {
  open: (this: unknown, name: string, version?: number) => unknown;
  deleteDatabase: (this: unknown, name: string) => unknown;
  /** Absent in older engines; the installer leaves it absent rather than inventing one. */
  databases?: (this: unknown) => Promise<readonly DatabaseInfoLike[]>;
}

/**
 * Marks a prototype as already patched.
 *
 * A registered symbol rather than module state: the same prototype can be reached by two
 * evaluations of the shim (a reinjected content script), and the guard must live on the
 * object being patched, not in a copy of this module that the second evaluation does not
 * share. Double-patching would prefix every name twice.
 */
export const IDB_NAMESPACE_MARK = Symbol.for('tabsona.idbNamespace');

/** What the installer achieved, reported so the badge can claim only what happened. */
export interface IdbNamespaceResult {
  /** open, deleteDatabase and (when present) databases are all translated. */
  readonly installed: boolean;
  /** `IDBDatabase.name` reads back the app's own name. False leaves the prefix visible
   *  to an app that reads it, which is reported but does not break isolation. */
  readonly nameGetterPatched: boolean;
}

/**
 * Translate every IndexedDB database name the page uses into `<sessionId>::<name>`.
 *
 * Invariants callers can rely on:
 * - a name goes in qualified and comes out unqualified, so the app only ever sees the
 *   names it chose;
 * - `databases()` hides every database that is not this session's, including the plain
 *   browser's, so one persona cannot discover or open another's;
 * - `deleteDatabase` can only ever delete this session's database;
 * - a second call on the same prototype is a no-op that still reports installed.
 */
export function installIdbNamespace(
  factoryProto: IdbFactoryProto,
  databaseProto: object,
  sessionId: SessionId,
): IdbNamespaceResult {
  if (Object.prototype.hasOwnProperty.call(factoryProto, IDB_NAMESPACE_MARK)) {
    return { installed: true, nameGetterPatched: Object.prototype.hasOwnProperty.call(databaseProto, IDB_NAMESPACE_MARK) };
  }

  const realOpen = factoryProto.open;
  const realDelete = factoryProto.deleteDatabase;
  const realDatabases = factoryProto.databases;

  factoryProto.open = function open(this: unknown, name: string, version?: number) {
    const qualified = qualify(String(name), sessionId);
    // Forward the version only when given: `open(name, undefined)` is not the same call
    // as `open(name)` to every engine, and the app's own arity must be preserved.
    return version === undefined ? realOpen.call(this, qualified) : realOpen.call(this, qualified, version);
  };

  factoryProto.deleteDatabase = function deleteDatabase(this: unknown, name: string) {
    return realDelete.call(this, qualify(String(name), sessionId));
  };

  if (realDatabases) {
    factoryProto.databases = async function databases(this: unknown) {
      const all = await realDatabases.call(this);
      return ownDatabases(all, sessionId);
    };
  }

  Object.defineProperty(factoryProto, IDB_NAMESPACE_MARK, { value: true });

  return { installed: true, nameGetterPatched: patchNameGetter(databaseProto, sessionId) };
}

/**
 * This session's databases from a `databases()` listing, with the prefix removed.
 *
 * Exported because it is the rule that keeps personas from seeing each other's data, and
 * it deserves a test that names it.
 */
export function ownDatabases(all: readonly DatabaseInfoLike[], sessionId: SessionId): DatabaseInfoLike[] {
  const out: DatabaseInfoLike[] = [];
  for (const info of all) {
    const name = info.name === undefined ? null : unqualify(info.name, sessionId);
    if (name === null) continue;
    out.push(info.version === undefined ? { name } : { name, version: info.version });
  }
  return out;
}

/** Make `db.name` return the app's own name. False when the getter cannot be found. */
function patchNameGetter(databaseProto: object, sessionId: SessionId): boolean {
  const desc = Object.getOwnPropertyDescriptor(databaseProto, 'name');
  const realGet = desc?.get;
  if (!desc || !realGet) return false;
  Object.defineProperty(databaseProto, 'name', {
    configurable: desc.configurable ?? true,
    enumerable: desc.enumerable ?? true,
    get(this: unknown) {
      const raw: unknown = realGet.call(this);
      return typeof raw === 'string' ? unqualify(raw, sessionId) ?? raw : raw;
    },
  });
  Object.defineProperty(databaseProto, IDB_NAMESPACE_MARK, { value: true });
  return true;
}
