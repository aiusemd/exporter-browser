import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

// @testing-library/preact's auto-cleanup expects a global `afterEach`. Vitest
// only exposes those when `globals: true`, which we don't want to flip on for
// the whole project. Calling cleanup ourselves keeps tests isolated.
afterEach(() => {
  cleanup();
});
