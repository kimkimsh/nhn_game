/**
 * 노말 카드 14종 — 스펙 §11.3
 *
 * 노말은 수치 강화이고 대부분 중첩된다. 값이나 maxStack을 바꾸면 §11.6의 최악 조합 검산 두 건이
 * 무효가 되므로 tests/cards.test.ts를 함께 갱신한다.
 *
 * textTemplate의 {value}는 sim/cards.ts가 effects[0].value의 절대값으로 채운다 — 부호와 단위는
 * 템플릿이 갖는다. 문구에 숫자를 직접 적으면 계수를 고칠 때 카드 화면만 옛 숫자를 계속 보여준다
 * (12_통합_계약.md §8-12).
 *
 * value의 단위는 op가 정한다. 'addPercent'는 %, 'addFlat'은 대상이 거리면 u이고 시간이면 초다.
 * 어느 쪽인지는 target 이름과 textTemplate이 함께 말한다.
 */
import type { CardDef } from '../types';
import type { NormalCardId } from '../ids';

export const NORMAL_CARDS = {
  N01: {
    name: '검격 연마',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '반사탄 데미지 +{value}%',
    effects: [{ kind: 'stat', target: 'reflectDamage', op: 'addPercent', value: 15 }],
  },
  N02: {
    name: '발놀림',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '이동 속도 +{value}%',
    effects: [{ kind: 'stat', target: 'moveSpeed', op: 'addPercent', value: 12 }],
  },
  N03: {
    name: '넓은 소매',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '패리 반경 +{value}u',
    effects: [{ kind: 'stat', target: 'parryRadius', op: 'addFlat', value: 6 }],
  },
  N04: {
    name: '빠른 손',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '패리 쿨다운 −{value}%',
    // §11.3 이 값이 작은 것은 카드가 약해서가 아니라 기본 쿨다운이 0.38에서 0.24초로 내려갔기
    // 때문이다. INV-1이 정하는 실효 하한(활성 0.15 + 0.05 = 0.20초)까지 여유가 0.04초뿐이고
    // 3중첩 −18%가 그 여유를 거의 다 쓴다. 값을 올려도 하한에 막혀 나타나지 않는다
    effects: [{ kind: 'stat', target: 'parryCooldown', op: 'addPercent', value: -6 }],
  },
  N05: {
    name: '긴 호흡',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '패리 활성 시간 +{value}초',
    // §11.3 N04와 서로를 갉아먹는다. 활성이 늘면 INV-1이 요구하는 최소 쿨다운도 같이 올라가
    // N04의 단축분이 되돌려진다. 의도된 상충이고 §11.6 검산 1이 그 수치를 갖는다.
    // 값이 작은 이유도 N04와 같다 — 활성 +0.01초마다 INV-1 하한이 그만큼 올라간다
    effects: [{ kind: 'stat', target: 'parryActive', op: 'addFlat', value: 0.01 }],
  },
  N06: {
    name: '강궁 반사',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '반사탄 속도 +{value}%',
    effects: [{ kind: 'stat', target: 'reflectSpeed', op: 'addPercent', value: 20 }],
  },
  N07: {
    name: '굳은살',
    rarity: 'NORMAL',
    maxStack: 2,
    textTemplate: 'GOOD 밴드 상한 +{value}u',
    effects: [{ kind: 'stat', target: 'goodBandMaxDist', op: 'addFlat', value: 4 }],
  },
  N08: {
    name: '정신 집중',
    rarity: 'NORMAL',
    maxStack: 2,
    textTemplate: 'GREAT 밴드 상한 +{value}u',
    effects: [{ kind: 'stat', target: 'greatBandMaxDist', op: 'addFlat', value: 3 }],
  },
  N09: {
    name: '무명 병졸의 갑옷',
    rarity: 'NORMAL',
    maxStack: 2,
    textTemplate: '피격 무적 시간 +{value}초',
    effects: [{ kind: 'stat', target: 'hitInvuln', op: 'addFlat', value: 0.3 }],
  },
  N10: {
    name: '잔상',
    rarity: 'NORMAL',
    maxStack: 1,
    textTemplate: '패리 성공 무적 +{value}초 (INV-2 상한 적용)',
    // §11.6 8단계 INV-2가 무적을 쿨다운 × 0.75로 자른다. 값이 작은 이유가 여기 있다 —
    // 최악 조합의 쿨다운 0.23초면 상한이 0.1725초인데 기본 0.14 + 0.03 = 0.17초가 그 바로
    // 아래다. 조금만 더 올리면 카드가 상한에 통째로 먹혀 아무 일도 하지 않는다(§11.6 검산 1)
    effects: [{ kind: 'stat', target: 'parryInvuln', op: 'addFlat', value: 0.03 }],
  },
  N11: {
    name: '사기 진작',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '콤보 유지 시간 +{value}초',
    effects: [{ kind: 'stat', target: 'comboHold', op: 'addFlat', value: 0.5 }],
  },
  N12: {
    name: '곧은 칼날',
    rarity: 'NORMAL',
    maxStack: 3,
    textTemplate: '반사탄 판정 크기 +{value}%',
    // §11.3 커지는 것은 적에게 명중하는 판정뿐이다. 플레이어 피격 판정(HR-07)은 원래 크기
    // 그대로다 — 자기 강화 카드가 자기 위험까지 키우면 카드를 고를 이유가 사라진다
    effects: [{ kind: 'stat', target: 'reflectHitRadius', op: 'addPercent', value: 25 }],
  },
  N13: {
    name: '반보 물러서기',
    rarity: 'NORMAL',
    maxStack: 1,
    textTemplate: '빈 패리 시 쿨다운 −{value}%',
    // §5.4 빈 패리에는 무적이 없다. 이 카드는 무적을 주는 것이 아니라 실패했을 때 다시 시도할
    // 기회를 앞당길 뿐이다.
    //
    // 명목 −40%는 어떤 빌드에서도 그대로 나오지 않는다. INV-1 하한이 실효를 통째로 먹는다
    // (12_통합_계약.md §10 E-05).
    //
    //   빌드                    활성   INV-1 하한   정상 쿨다운      빈 패리 쿨다운    실효
    //   기본 (N13만)            0.15   0.20         0.24             0.144 → 0.20     −17%
    //   + N05 ×3                0.18   0.23         0.24             0.144 → 0.23     −4%
    //   + N04 ×3 + N05 ×3       0.18   0.23         0.1968 → 0.23    0.118 → 0.23     정확히 0
    //
    // N05만으로 0이 되지 않는 것은 정상 쿨다운 0.24가 아직 하한 0.23 위에 한 칸 남아 있기
    // 때문이다. 정상 쿨다운까지 하한에 닿아야 두 값이 같아지고 그러려면 N04 3중첩이 함께
    // 필요하다. −40%라는 표기만 보고 이 값을 바꾸면 안 된다
    effects: [{ kind: 'stat', target: 'whiffCooldown', op: 'addPercent', value: -40 }],
  },
  N14: {
    name: '회복',
    rarity: 'NORMAL',
    maxStack: Infinity, // §11.3 무제한
    textTemplate: '즉시 라이프 +{value} (최대치 초과 불가)',
    // 즉발이라 'stat'이 아니다 — 스냅샷 필드를 올리는 것이 아니라 RunState의 life를 한 번
    // 올린다. 카드를 제거해도 되돌아가지 않는다(§18.4)
    effects: [{ kind: 'instantLife', value: 1 }],
    // §11.2 라이프가 최대치면 효과가 무의미하므로 그 상태에서는 제시 풀에서 빠진다
    hideWhen: 'lifeAtMax',
  },
} as const satisfies Record<NormalCardId, CardDef>;
