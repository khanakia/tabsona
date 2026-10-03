# Contributing

Thanks for looking. This is a small, opinionated tool — the fastest way to get a change merged is to understand the two rules it is built around.

## The two rules

**1. Nothing counts as isolated until it has been demonstrated failing.** Every claim about isolation ships with a test that breaks the mechanism and watches the leak appear. A guard nobody has seen fail is an unverified claim. Several real bugs here were found exactly this way, and at least one "passing" assertion turned out to be comparing two error objects.

**2. Degradation is reported, never hidden.** If a layer cannot be isolated on a given origin, the badge says so, in the page. A tool that *looks* isolated while leaking is worse than no tool — it turns every later bug into a question about whether the tool lied.

Read [`docs/how-it-works.md`](docs/how-it-works.md) before changing anything in `src/engine/` or `src/content/`.

## Getting set up

```bash
task install
task build          # -> apps/extension/dist
```

Load `apps/extension/dist` at `chrome://extensions` with Developer mode on.

## The gate

```bash
task check
```

Type-check, unit tests, a build, and every end-to-end suite. **It must pass before a pull request.** The end-to-end suites drive the real built extension in a real Chrome, so they need a working Chrome install; they run headless and will not steal your focus.

Against one of your own apps:

```bash
export SYNC_USER1=you@example.test SYNC_PASS1=...
export SYNC_USER2=other@example.test SYNC_PASS2=...
APP_ORIGIN=https://your.app task e2e:app
```

Never commit credentials. The drivers read them from the environment for exactly this reason.

## Code standards

- **Full type safety.** No `any`, no `as any`, no `@ts-ignore`, no non-null assertions used to dodge a real check. A boundary cast is allowed only where the type system genuinely cannot express the contract, and it carries a comment saying why.
- **No bare closed-set literals or magic numbers.** Named constants in `src/core/constants.ts`, or a discriminated union, which is stronger.
- **Doc comments carry the why.** Every exported function, type and constant states what it is for, the non-obvious reason it exists, and any invariant a caller must respect. `// gets the user` adds nothing.
- **Layering is enforced by a test**, not by good intentions — `src/core/__tests__/boundaries.test.ts`. `domain/` imports nothing, `core/` never names a chrome API, exactly one UI module does, presenters never import the client, surfaces never deep-import past a barrel.
- **A presenter's test needs no module mocks.** If a test reaches for one, the component is fused to the data layer and should be split.

## Where things live

| Path | What |
|---|---|
| `apps/extension/src/domain` | the vocabulary — zero imports |
| `apps/extension/src/core` | pure logic, unit-tested with no mocks |
| `apps/extension/src/engine` | the `chrome.*` adapters |
| `apps/extension/src/features` | presenters, one folder each |
| `apps/extension/src/surfaces` | popup and options pages |
| `spike/` | the end-to-end drivers and the two-role fixture app |
| `docs/` | public documentation |

## Reporting a bug

Include what you expected, what happened, the site (or a reproduction), and whether the tab's badge said anything. If it involves isolation leaking, say which layer — the badge names it.

Three of the sharpest bugs in this project were found by a user reasoning about the model rather than by the test suite. If something looks wrong in principle, that is worth an issue even without a reproduction.
