// Unmount the DOM between tests.
//
// @testing-library/react only auto-cleans when vitest runs with `globals: true`, which
// this project does not — so without this every render accumulates and queries start
// finding several matches. The failure looks like a component bug and is not one.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
