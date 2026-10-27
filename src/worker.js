import { run, FixtureError } from './language.js';

self.addEventListener('message', async ({ data }) => {
  try {
    const dataset = await run(data.source, {
      onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'result', dataset });
  } catch (error) {
    self.postMessage({
      type: 'error',
      diagnostic: error instanceof FixtureError
        ? error.diagnostic
        : { code: 'INTERNAL', message: 'The worker could not finish this fixture.', line: 1, column: 1 },
    });
  }
});
