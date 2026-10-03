## What this changes

<!-- The behaviour, not the files. -->

## Why

<!-- The non-obvious reason. If it fixes something, what was the failure? -->

## Checklist

- [ ] `task check` passes — type-check, unit tests, build, and every end-to-end suite
- [ ] New exported functions, types and constants carry a doc comment stating **why** they exist and any invariant callers must respect
- [ ] No `any`, `as any`, `@ts-ignore`, or non-null assertions used to dodge a real check
- [ ] No bare closed-set literals or magic numbers — named constants, or a discriminated union
- [ ] If this touches isolation: there is a test that **breaks the mechanism and watches the leak appear**, not only one that confirms the happy path
- [ ] If this changes what the extension can or cannot isolate: `docs/limits.md` and the badge's coverage reporting are updated too
