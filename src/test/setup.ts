import '@testing-library/jest-dom';
import { server } from './mocks/server';

// Start MSW before all tests, reset handlers between tests, stop after all
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Stub localStorage — only available in browser-like environments
beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
