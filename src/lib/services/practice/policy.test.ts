import { describe, expect, it } from 'vitest';

import { decidePolicy, type PolicyProfile } from './policy';

function profile(overrides: Partial<PolicyProfile> = {}): PolicyProfile {
  return {
    interleavingTolerance: 0.5,
    preferredSessionMinutes: 20,
    avgResponseTimeMs: null,
    ...overrides,
  };
}

describe('decidePolicy', () => {
  it('mix=false всегда даёт нулевой интерливинг, даже если профиль его допускает', () => {
    const policy = decidePolicy({ profile: profile({ interleavingTolerance: 0.6 }), mix: false });
    expect(policy.interleaveRatio).toBe(0);
  });

  it('mix=true без явного значения берёт интерливинг из профиля', () => {
    const policy = decidePolicy({ profile: profile({ interleavingTolerance: 0.35 }), mix: true });
    expect(policy.interleaveRatio).toBe(0.35);
  });

  it('явный interleaveRatio старше профиля', () => {
    const policy = decidePolicy({ profile: profile({ interleavingTolerance: 0.35 }), mix: true, explicitInterleaveRatio: 0.5 });
    expect(policy.interleaveRatio).toBe(0.5);
  });

  it('явный limit проходит без изменений', () => {
    const policy = decidePolicy({ profile: profile(), mix: false, explicitLimit: 7 });
    expect(policy.limit).toBe(7);
  });

  it('без явного limit подбирает его по темпу и желаемой длине сессии', () => {
    const policy = decidePolicy({
      profile: profile({ preferredSessionMinutes: 10, avgResponseTimeMs: 5_000 }),
      mix: false,
    });
    // (10*60000) / (5000+15000) = 30 -> ограничено MAX_LIMIT.
    expect(policy.limit).toBeLessThanOrEqual(30);
    expect(policy.limit).toBeGreaterThanOrEqual(4);
  });

  it('лимит не уходит ниже минимума на очень короткой предпочитаемой сессии', () => {
    const policy = decidePolicy({
      profile: profile({ preferredSessionMinutes: 1, avgResponseTimeMs: 60_000 }),
      mix: false,
    });
    expect(policy.limit).toBeGreaterThanOrEqual(4);
  });
});
