/**
 * MSW browser setup for development and testing.
 */
import { setupWorker } from 'msw/browser';
import { summaryHandlers } from './handlers';

export const worker = setupWorker(...summaryHandlers);
