import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createChatModel, loadLlmConfig } from 'api/agent';
import { describe, expect, it } from 'vitest';
import {
  EVALS_DIR,
  loadDataset,
  loadRecording,
  replayModel,
  runCase,
  saveRecording,
  scrub,
  SECRET_PATTERNS,
  type CaseResult,
} from './lib.js';

/**
 * Modes:
 * - default (PR CI): replays evals/recordings/*.json. Deterministic, offline, free.
 * - EVAL_LIVE=1 (nightly): calls the configured model. Needs LLM_* / OPENAI_* or AZURE_OPENAI_* variables.
 * - EVAL_RECORD=1: like live, then writes scrubbed recordings. Review the diff before committing.
 */
const record = process.env.EVAL_RECORD === '1';
const live = record || process.env.EVAL_LIVE === '1';
const minScore = Number(process.env.EVAL_MIN_SCORE ?? '0.8');

describe(`agent evals (${live ? (record ? 'record' : 'live') : 'replay'})`, () => {
  it(`scores at least EVAL_MIN_SCORE=${minScore}`, async () => {
    const dataset = loadDataset();
    const results: CaseResult[] = [];
    for (const evalCase of dataset) {
      try {
        if (live) {
          const llm = loadLlmConfig();
          const result = await runCase(evalCase, createChatModel(llm), llm.model);
          if (record) saveRecording(evalCase, llm.model, result.messages);
          results.push(result);
        } else {
          const recording = loadRecording(evalCase.id);
          results.push(await runCase(evalCase, replayModel(recording), recording.model));
        }
      } catch (error) {
        // A crashing case scores 0 instead of aborting the suite. Only the error name: messages may hold data.
        const reason = `run failed (${error instanceof Error ? error.name : 'unknown'})`;
        results.push({ id: evalCase.id, passed: false, reason, messages: [] });
      }
    }
    const score = results.filter((r) => r.passed).length / results.length;
    console.warn(
      [
        `eval score ${score.toFixed(2)} (min ${minScore})`,
        ...results.map((r) => `  ${r.passed ? 'PASS' : 'FAIL'} ${r.id}: ${r.reason}`),
      ].join('\n'),
    );
    expect(score).toBeGreaterThanOrEqual(minScore);
  });

  it('scrubs credentials before writing recordings', () => {
    const fakeKey = ['sk', 'proj', 'A'.repeat(24)].join('-');
    const text = scrub(`key ${fakeKey} and Bearer ${'b'.repeat(20)} and custom-secret-value`, {
      AZURE_OPENAI_API_KEY: 'custom-secret-value',
    });
    expect(text).toBe('key [REDACTED] and [REDACTED] and [REDACTED]');
  });

  it('recordings contain no credentials', () => {
    const dir = join(EVALS_DIR, 'recordings');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const pattern of SECRET_PATTERNS)
        expect(text.match(pattern), `${file} matches ${pattern}`).toBeNull();
    }
  });
});
