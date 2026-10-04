import { describe, expect, it } from 'vitest';
import { IDB_NAMESPACE_MARK, installIdbNamespace, ownDatabases, type DatabaseInfoLike, type IdbFactoryProto } from '../idb';

/**
 * A stand-in for the browser's IndexedDB, holding databases by their REAL (stored) name.
 *
 * No module mocks and no fake-indexeddb: the installer takes the prototypes it patches as
 * arguments, so a plain object proves every rule. `calls` records the real names the
 * browser would have been asked for — the thing isolation actually depends on.
 */
function stubBrowser(existing: readonly string[] = []) {
  const stored = new Set(existing);
  const calls: string[] = [];
  const receivers: unknown[] = [];
  const factoryProto: IdbFactoryProto = {
    open(this: unknown, name: string, version?: number) {
      receivers.push(this);
      calls.push(version === undefined ? `open ${name}` : `open ${name} v${version}`);
      stored.add(name);
      return { name };
    },
    deleteDatabase(this: unknown, name: string) {
      calls.push(`delete ${name}`);
      stored.delete(name);
      return { name };
    },
    async databases(this: unknown) {
      return [...stored].map((name): DatabaseInfoLike => ({ name, version: 1 }));
    },
  };
  // A database object whose `name` getter reads its real, stored name — as Chrome's does.
  const databaseProto = {};
  Object.defineProperty(databaseProto, 'name', {
    configurable: true,
    enumerable: true,
    get(this: { realName: string }) { return this.realName; },
  });
  const dbNamed = (realName: string): { name: string } => Object.assign(Object.create(databaseProto), { realName });
  return { factoryProto, databaseProto, calls, receivers, stored, dbNamed };
}

describe('installIdbNamespace', () => {
  it('opens the session\'s own copy of a database, under its namespaced name', () => {
    const b = stubBrowser();
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    b.factoryProto.open('app-db');
    expect(b.calls).toEqual(['open s_a::app-db']);
  });

  it('passes the version through, and only when the app gave one', () => {
    const b = stubBrowser();
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    b.factoryProto.open('app-db', 3);
    b.factoryProto.open('app-db');
    expect(b.calls).toEqual(['open s_a::app-db v3', 'open s_a::app-db']);
  });

  it('calls the real method on the receiver the app used, so Chrome does not throw Illegal invocation', () => {
    const b = stubBrowser();
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    const factory = Object.create(b.factoryProto) as IdbFactoryProto;
    factory.open('app-db');
    expect(b.receivers[0]).toBe(factory);
  });

  it('gives two personas two separate databases for the same app name', () => {
    const a = stubBrowser();
    installIdbNamespace(a.factoryProto, a.databaseProto, 's_a');
    a.factoryProto.open('lab-notes');
    const bProto = stubBrowser();
    installIdbNamespace(bProto.factoryProto, bProto.databaseProto, 's_b');
    bProto.factoryProto.open('lab-notes');
    expect(a.calls[0]).not.toBe(bProto.calls[0]);
  });

  it('can only ever delete the session\'s own database', () => {
    const b = stubBrowser(['s_a::app-db', 's_b::app-db', 'app-db']);
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    b.factoryProto.deleteDatabase('app-db');
    expect([...b.stored].sort()).toEqual(['app-db', 's_b::app-db']);
  });

  it('lists only the session\'s databases, with the prefix removed', async () => {
    const b = stubBrowser(['s_a::app-db', 's_a::cache', 's_b::app-db', 'app-db']);
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    const names = (await b.factoryProto.databases?.call(b.factoryProto))?.map((d) => d.name).sort();
    expect(names).toEqual(['app-db', 'cache']);
  });

  it('reads back the name the app asked for from an open database', () => {
    const b = stubBrowser();
    const result = installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    expect(result.nameGetterPatched).toBe(true);
    expect(b.dbNamed('s_a::app-db').name).toBe('app-db');
  });

  it('leaves a name it did not namespace exactly as it is', () => {
    const b = stubBrowser();
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    expect(b.dbNamed('legacy-db').name).toBe('legacy-db');
  });

  it('is idempotent — a second install must not prefix names twice', () => {
    const b = stubBrowser();
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    const again = installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    b.factoryProto.open('app-db');
    expect(again.installed).toBe(true);
    expect(b.calls).toEqual(['open s_a::app-db']);
    expect(Object.prototype.hasOwnProperty.call(b.factoryProto, IDB_NAMESPACE_MARK)).toBe(true);
  });

  it('keeps a separator inside the app\'s own name intact', () => {
    const b = stubBrowser();
    installIdbNamespace(b.factoryProto, b.databaseProto, 's_a');
    b.factoryProto.open('team::db');
    expect(b.calls).toEqual(['open s_a::team::db']);
    expect(b.dbNamed('s_a::team::db').name).toBe('team::db');
  });

  it('works without databases(), which older engines lack, and does not invent one', () => {
    const b = stubBrowser();
    const withoutListing: IdbFactoryProto = { open: b.factoryProto.open, deleteDatabase: b.factoryProto.deleteDatabase };
    const result = installIdbNamespace(withoutListing, b.databaseProto, 's_a');
    expect(result.installed).toBe(true);
    expect('databases' in withoutListing).toBe(false);
  });

  it('reports the name getter as unpatched when the prototype has none', () => {
    const b = stubBrowser();
    expect(installIdbNamespace(b.factoryProto, {}, 's_a').nameGetterPatched).toBe(false);
  });
});

describe('ownDatabases', () => {
  it('drops entries without a name and other sessions\' entries', () => {
    expect(ownDatabases([{}, { name: 's_b::x' }, { name: 's_a::x', version: 2 }], 's_a'))
      .toEqual([{ name: 'x', version: 2 }]);
  });

  it('does not treat a prefix of the session id as a match', () => {
    // s_a must never see s_ab's databases.
    expect(ownDatabases([{ name: 's_ab::x' }], 's_a')).toEqual([]);
  });
});
