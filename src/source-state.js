import { EXAMPLES } from './examples.js';

// Built-in examples are reproducible. Every other nonempty source must be
// treated as unretained: starting a download cannot confirm that it was saved.
export function sourceExample(source) {
  return EXAMPLES.find(example => example.source === source)?.id || '';
}

export function needsSourceProtection(source) {
  return source !== '' && sourceExample(source) === '';
}
