import { describe, it, expect, beforeEach } from 'vitest';
import { parseRepoArg, resolveAgent, resolvePr, resolveRepo, ToolError } from '../src/devdigest/resolve.js';
import { FakeDevDigestApi, makeAgent, makePr, makeRepo } from './helpers/fake-api.js';

describe('parseRepoArg', () => {
  it('accepts owner/name as-is', () => {
    expect(parseRepoArg('acme/payments-api')).toBe('acme/payments-api');
  });

  it('normalises GitHub URL forms', () => {
    expect(parseRepoArg('https://github.com/acme/payments-api')).toBe('acme/payments-api');
    expect(parseRepoArg('https://github.com/acme/payments-api.git')).toBe('acme/payments-api');
    expect(parseRepoArg('https://github.com/acme/payments-api/')).toBe('acme/payments-api');
    expect(parseRepoArg('https://github.com/acme/payments-api/pulls/482')).toBe('acme/payments-api');
    expect(parseRepoArg('https://GitHub.com/Acme/Payments-API')).toBe('Acme/Payments-API');
  });

  it('rejects path traversal, a leading "-", and garbage', () => {
    expect(() => parseRepoArg('../etc/passwd')).toThrow(ToolError);
    expect(() => parseRepoArg('-acme/payments-api')).toThrow(ToolError);
    expect(() => parseRepoArg('acme/-payments-api')).toThrow(ToolError);
    expect(() => parseRepoArg('not a repo at all')).toThrow(ToolError);
    expect(() => parseRepoArg('')).toThrow(ToolError);
  });
});

describe('resolveRepo / resolvePr / resolveAgent', () => {
  let api: FakeDevDigestApi;

  beforeEach(() => {
    api = new FakeDevDigestApi();
  });

  it('resolves a repo case-insensitively by full_name', async () => {
    const repo = makeRepo({ full_name: 'Acme/Payments-API' });
    api.repos = [repo];

    const resolved = await resolveRepo(api, 'acme/payments-api');
    expect(resolved).toEqual({ id: repo.id, full_name: repo.full_name });
  });

  it('errors forward-leading on an unknown repo, naming the available slugs', async () => {
    api.repos = [makeRepo({ full_name: 'acme/payments-api' }), makeRepo({ full_name: 'acme/web' })];

    await expect(resolveRepo(api, 'acme/nope')).rejects.toMatchObject({
      message: expect.stringContaining('acme/payments-api'),
    });
    await expect(resolveRepo(api, 'acme/nope')).rejects.toMatchObject({
      message: expect.stringContaining('acme/web'),
    });
  });

  it('does not fuzzy/prefix match', async () => {
    api.repos = [makeRepo({ full_name: 'acme/payments-api-v2' })];
    await expect(resolveRepo(api, 'acme/payments-api')).rejects.toThrow(ToolError);
  });

  it('resolves a PR by number, skipping rows with a null id', async () => {
    const repo = { id: 'r1', full_name: 'acme/payments-api' };
    api.pulls['r1'] = [makePr({ id: null, number: 481 }), makePr({ id: 'pr-482', number: 482 })];

    const resolved = await resolvePr(api, repo, 482);
    expect(resolved).toEqual({ id: 'pr-482', number: 482, title: expect.any(String) });
  });

  it('errors forward-leading on an unknown PR number, naming real PR numbers', async () => {
    const repo = { id: 'r1', full_name: 'acme/payments-api' };
    api.pulls['r1'] = [makePr({ id: 'pr-482', number: 482 }), makePr({ id: 'pr-481', number: 481 })];

    await expect(resolvePr(api, repo, 999)).rejects.toMatchObject({
      message: expect.stringMatching(/#482.*#481|#481.*#482/),
    });
  });

  it('resolves an agent case-insensitively', async () => {
    const agent = makeAgent({ name: 'General' });
    api.agents = [agent];

    const resolved = await resolveAgent(api, 'general');
    expect(resolved).toEqual({ id: agent.id, name: 'General' });
  });

  it('errors forward-leading on an unknown agent, naming available agents', async () => {
    api.agents = [makeAgent({ name: 'General' }), makeAgent({ name: 'Security' })];

    await expect(resolveAgent(api, 'Secrity')).rejects.toMatchObject({
      message: expect.stringContaining('list_agents'),
    });
  });

  it('a case-insensitive tie is ambiguous, naming both, then resolves on an exact-case retry', async () => {
    const a = makeAgent({ name: 'General' });
    const b = makeAgent({ name: 'general' });
    api.agents = [a, b];

    await expect(resolveAgent(api, 'GENERAL')).rejects.toMatchObject({
      message: expect.stringMatching(/General.*general|general.*General/),
    });

    const resolved = await resolveAgent(api, 'general');
    expect(resolved).toEqual({ id: b.id, name: 'general' });
  });

  it('never caches — two calls make two API calls', async () => {
    api.repos = [makeRepo({ full_name: 'acme/payments-api' })];
    await resolveRepo(api, 'acme/payments-api');
    await resolveRepo(api, 'acme/payments-api');
    expect(api.callCount('listRepos')).toBe(2);
  });

  it('never calls GET /pulls/:id (listPulls only) to resolve a PR', async () => {
    const repo = { id: 'r1', full_name: 'acme/payments-api' };
    api.pulls['r1'] = [makePr({ id: 'pr-482', number: 482 })];
    await resolvePr(api, repo, 482);
    expect(api.calls.every((c) => c.method !== ('getPull' as never))).toBe(true);
    expect(api.callCount('listPulls')).toBe(1);
  });
});
