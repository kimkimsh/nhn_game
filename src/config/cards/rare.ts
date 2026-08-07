/**
 * 레어 카드 10종 — 스펙 §11.4
 *
 * 이 파일의 모든 값은 §11.4 표를 그대로 옮긴 것이다. 그 표 밖에서 온 값에만 따로 절 번호를 단다.
 *
 * 레어의 정의는 "반사탄 동작 변경"이다(§11.2). 그래서 열 중 여섯이 kind:'stat'으로 표현되지
 * 않는다 — 수치 한 칸을 옮기는 것이 아니라 반사 자체의 모양이나 성립 조건을 바꾸기 때문이다.
 *
 * R05와 R10은 값이 런타임에 변하거나 §11.6의 보정 순서에 자리가 없어 정적 스냅샷이 되지 않는다.
 * 여기에는 파라미터만 두고, 합성은 sim/stats.ts의 런타임 파생이 맡는다(12_통합_계약.md §10 E-05).
 *
 * textTemplate의 {value}는 sim/cards.ts가 effects[0].value의 절대값으로 채운다. effects[0]에
 * value 필드가 없는 카드는 채울 자리가 없어 숫자를 문장에 직접 적었고, 그 숫자가 effect의 어느
 * 필드를 비추는지는 항목 주석이 밝힌다.
 */
import type { CardDef } from '../types';
import type { RareCardId } from '../ids';

export const RARE_CARDS = {
  R01: {
    name: '쌍검',
    rarity: 'RARE',
    maxStack: 1,
    // 숫자 셋은 아래 effects의 count · spreadDeg · damageRatio를 비춘다
    textTemplate: '반사탄이 2발로 분열 (각 ±8°) · 각 데미지 65%',
    // §11.6 분열 계수는 보정 순서의 맨 뒤에서 곱연산한다. E01을 함께 보유하면 분열이 중첩되어
    // 발수가 곱해지고 계수도 곱해진다 — 두 카드는 서로를 배제하지 않는다
    effects: [{ kind: 'splitReflect', count: 2, spreadDeg: 8, damageRatio: 0.65 }],
  },
  R02: {
    name: '관통',
    rarity: 'RARE',
    maxStack: 2,
    textTemplate: '반사탄이 적 {value}기를 추가 관통',
    effects: [{ kind: 'stat', target: 'reflectPierce', op: 'addFlat', value: 1 }],
  },
  R03: {
    name: '자석 반사',
    rarity: 'RARE',
    maxStack: 1,
    textTemplate: '반사탄이 가장 가까운 적 방향으로 초당 {value}° 유도',
    // §6.1 P11의 유도와 다른 축이다. 저쪽은 적 탄환이 갖는 성질이고 이것은 반사탄에 붙는다
    effects: [{ kind: 'stat', target: 'reflectHomingDegPerSec', op: 'addFlat', value: 180 }],
  },
  R04: {
    name: '되받아치기',
    rarity: 'RARE',
    maxStack: 1,
    // 문구는 목업 11_card_select/scene.js의 승인된 표기다. ×1.5는 아래 damageMul을 비춘다
    textTemplate: 'GREAT 패리로 만든 반사탄의 데미지 ×1.5',
    // §11.6 조건부 배수는 카드 간 가산 %를 1회 곱연산한 뒤에 다시 곱한다 — 가산 항이 아니다
    effects: [{ kind: 'conditionalDamage', on: 'parryGreat', damageMul: 1.5 }],
  },
  R05: {
    name: '연격',
    rarity: 'RARE',
    maxStack: 1,
    // 숫자 셋은 perCombo · addPercentPerStep · maxAddPercent를 비춘다
    textTemplate: '콤보 10마다 반사탄 데미지 +10% (최대 +50%)',
    // 콤보는 매 패리마다 오르고 §12.2의 유지 시간 경과·피격으로 0이 된다. 즉 §11.6 가산 %의
    // 곱 전체가 콤보 종속이라 스냅샷 필드가 될 수 없다 — sim/stats.ts가
    // reflectDamageMulFor(combo)로 노출한다(12_통합_계약.md §10 E-05)
    effects: [{ kind: 'comboDamage', perCombo: 10, addPercentPerStep: 10, maxAddPercent: 50 }],
  },
  R06: {
    name: '철벽',
    rarity: 'RARE',
    maxStack: 2,
    // 두 effect의 값이 같다는 전제로 {value}를 두 번 썼다. sim/cards.ts는 첫 자리만이 아니라
    // 모든 {value}를 effects[0].value로 바꿔야 한다
    textTemplate: '최대 라이프 +{value} · 즉시 라이프 +{value}',
    // 상한을 올리는 것과 지금 채우는 것은 다른 일이라 effect가 둘이다. 즉발 쪽은 RunState의
    // life를 한 번 올리는 것이어서 카드를 제거해도 되돌아가지 않는다(§18.4)
    effects: [
      { kind: 'stat', target: 'maxLife', op: 'addFlat', value: 1 },
      { kind: 'instantLife', value: 1 },
    ],
  },
  R07: {
    name: '시간 늦추기',
    rarity: 'RARE',
    maxStack: 1,
    // 숫자 둘은 durationSec · bulletSpeedMul을 비춘다
    textTemplate: 'GREAT 패리 시 0.35초간 적 탄환 속도 40%',
    // 대상이 스냅샷의 한 칸이 아니라 월드에 살아 있는 적 탄환 전부다. 반사탄은 느려지지 않는다
    effects: [{ kind: 'timedGlobal', on: 'parryGreat', durationSec: 0.35, bulletSpeedMul: 0.4 }],
  },
  R08: {
    name: '파편',
    rarity: 'RARE',
    maxStack: 1,
    // 숫자 둘은 count · damageRatio를 비춘다
    textTemplate: '반사탄 명중 시 6방향 파편 (각 데미지 25%)',
    // 파편도 반사탄이므로 §7.1의 자해 유예 0.15초가 그대로 붙고 그 뒤에는 플레이어에게 유효하다
    effects: [{ kind: 'shardBurst', on: 'reflectHit', count: 6, damageRatio: 0.25 }],
  },
  R09: {
    name: '넓은 인식',
    rarity: 'RARE',
    maxStack: 1,
    // −6u는 아래 둘째 effect의 value를 비춘다
    textTemplate: '패리 반경 +{value}u · 단 GREAT 밴드 상한 −6u',
    // 한 장 안에서 상충한다. 반경을 넓히면 패리는 쉬워지지만 GREAT을 받을 수 있는 고리는 좁아진다.
    // §11.6에서 밴드 조정은 전부 가산이고, 결과가 GREAT 상한 > GOOD 상한이 되면 GREAT을
    // GOOD 상한 값으로 자른다 — N08 · E05와 같은 자리에서 만난다
    effects: [
      { kind: 'stat', target: 'parryRadius', op: 'addFlat', value: 18 },
      { kind: 'stat', target: 'greatBandMaxDist', op: 'addFlat', value: -6 },
    ],
  },
  R10: {
    name: '무쌍',
    rarity: 'RARE',
    maxStack: 1,
    // 0.12초는 아래 minGapSec을 비춘다
    textTemplate: '패리가 성립하면 쿨다운 즉시 종료 (최소 간격 0.12초)',
    // 쿨다운 수치를 건드리지 않으므로 §11.6의 보정 순서 어디에도 자리가 없다. 성립한 순간에만
    // 쿨다운을 지우고 최소 간격만 남긴다 — sim/stats.ts의 r10ActiveMinGapSec가 이것을 들고 있다.
    // 빈 패리는 정상 쿨다운을 그대로 받으므로 §5.4의 억제 구조가 유지된다.
    //
    // §19 최소 간격은 0.06초에서 올린 값이다. T-02의 성공률 50%를 넣으면 0.06초는 평균 간격
    // 0.150초(유효 패리 +60%), 0.12초는 0.180초(+34%)다. +60%는 §14.4의 보스 HP 산출 전제를
    // 통째로 벗어난다. §11.6 검산 1이 아직 0.06초로 적혀 있는데 그것이 너프 이전 값이다
    effects: [{ kind: 'cooldownReset', on: 'parrySuccess', minGapSec: 0.12 }],
  },
} as const satisfies Record<RareCardId, CardDef>;
