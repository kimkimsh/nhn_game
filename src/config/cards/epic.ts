/**
 * 에픽 카드 7종 — 스펙 §11.5
 *
 * 이 파일의 모든 값은 §11.5 표를 그대로 옮긴 것이다. 그 표 밖에서 온 값에만 따로 절 번호를 단다.
 *
 * 에픽의 정의는 "게임 규칙 자체를 바꿈"이다(§11.2). 그래서 일곱 중 다섯이 각자 다른 kind를
 * 쓴다 — 수치 한 칸을 옮기는 것이 아니라 반사·피격·불변 조건의 규칙을 건드리기 때문이다.
 * 일곱 다 maxStack 1이고, 중첩 불가가 이 등급의 성질이다.
 *
 * E03은 스테이지가 넘어갈 때마다 값이 변해 정적 스냅샷이 되지 않는다. 능력치만 여기 두고
 * 현재 충전 수는 RunState가 갖는다(12_통합_계약.md §10 E-05).
 *
 * textTemplate의 {value} 규칙은 rare.ts와 같다 — sim/cards.ts가 effects[0].value의 절대값으로
 * 채우고, effects[0]에 value가 없는 카드는 숫자를 문장에 직접 적는다.
 */
import type { CardDef } from '../types';
import type { EpicCardId } from '../ids';

export const EPIC_CARDS = {
  E01: {
    name: '학익진',
    rarity: 'EPIC',
    maxStack: 1,
    // 숫자 셋은 아래 effects의 count · spreadDeg · damageRatio를 비춘다
    textTemplate: '반사탄이 3발 부채꼴 (±18°) · 각 데미지 55%',
    // §11.6 R01과 같은 분열 계수이고 마지막에 곱연산한다. 둘을 함께 보유하면 발수도 계수도
    // 곱해지므로, 계수를 고칠 때 R01과 짝을 맞춰 보지 않으면 조합 데미지가 조용히 어긋난다
    effects: [{ kind: 'splitReflect', count: 3, spreadDeg: 18, damageRatio: 0.55 }],
  },
  E02: {
    name: '신기전',
    rarity: 'EPIC',
    maxStack: 1,
    // 숫자 셋은 count · damageRatio · spreadDeg를 비춘다
    textTemplate: 'GREAT 패리 시 반사탄 대신 신기전 5연발 (각 데미지 80%, ±10°)',
    // §6.1 P10이 신기전이다. 값을 바꾸는 것이 아니라 반사 자체를 다른 발사체로 교체하므로,
    // 반경·속도는 반사된 원본 탄이 아니라 P10의 것을 따른다
    effects: [
      { kind: 'replaceReflect', on: 'parryGreat', bullet: 'P10', count: 5, spreadDeg: 10, damageRatio: 0.8 },
    ],
  },
  E03: {
    name: '거북선 등껍질',
    rarity: 'EPIC',
    maxStack: 1,
    // 숫자 셋은 maxCharges · chargesPerStage · invulnSec를 비춘다
    textTemplate: '피격을 무효화하는 보호막 최대 3중 · 스테이지 시작 시 1중 충전',
    // 스테이지가 시작될 때마다 1중씩 차오르므로 카드 목록이 그대로여도 값이 변한다. 여기 있는
    // 것은 능력치뿐이고 현재 충전 수는 RunState다(05_시스템_설계.md §5). 소모해도 라이프는
    // 줄지 않고 invulnSec만큼 무적만 준다 — §4.2의 피격 처리 자체가 일어나지 않는다
    effects: [{ kind: 'shield', maxCharges: 3, chargesPerStage: 1, invulnSec: 1.5 }],
  },
  E04: {
    name: '이순신의 판단',
    rarity: 'EPIC',
    maxStack: 1,
    textTemplate: '각 보스전 진입 시 화면 내 모든 적 탄환을 자동 GREAT 패리',
    // 수치가 아니라 사건이다. "각" 보스전이므로 한 런에서 최대 5회 발동한다.
    // 자동으로 매기는 등급이 GREAT이라 §5.3의 GREAT 배수·점수·히트스톱이 그대로 따라온다
    effects: [{ kind: 'onBossEnter', action: 'autoParryAll', grade: 'GREAT' }],
  },
  E05: {
    name: '영점 패리',
    rarity: 'EPIC',
    maxStack: 1,
    // 5.0은 아래 둘째 effect의 value를 비춘다. 목업 11_card_select/scene.js는 여기에 기본값
    // 3.5를 함께 적었는데, 그 값은 §5.3 밴드가 갖는 것이라 문구에 옮겨 적지 않는다
    textTemplate: 'GREAT 밴드 상한 +{value}u · GREAT 데미지 배수 5.0',
    // GREAT 데미지 배수는 §5.3 등급 밴드가 갖는 값이다. 배수를 코드에 리터럴로 박으면 이 카드를
    // 표현할 자리가 없어지므로, 밴드 항목을 갈아 끼우는 효과로 적는다 — op가 'set'인 유일한 자리다.
    // 밴드 상한 쪽은 §11.6의 가산이고 R09·N08과 같은 자리에서 만난다
    effects: [
      { kind: 'stat', target: 'greatBandMaxDist', op: 'addFlat', value: 10 },
      { kind: 'stat', target: 'greatDamageMul', op: 'set', value: 5.0 },
    ],
  },
  E06: {
    name: '화공',
    rarity: 'EPIC',
    maxStack: 1,
    // 숫자 셋은 radiusU · durationSec · dpsRatio를 비춘다
    textTemplate: '반사탄 명중 지점에 반경 60u 화염 장판 2초 (플레이어에게도 유효)',
    // §19 장판은 플레이어에게도 유해하며 피해는 §4.3의 장판 규칙을 따른다. 반경 60u가 P9의
    // 90u보다 작은 것은 그래서다 — 크기가 곧 자기 위험이므로 적을 태우는 데 필요한 최소에서
    // 출발한다. §9.6·§10.5의 동시 6개 상한을 P9와 공유하고, 초과하면 가장 오래된 것부터
    // 지운다. 그 상한 값은 여기가 아니라 ZoneConfig.maxConcurrent가 갖는다.
    // dpsRatio는 반사탄 데미지에 대한 비율이라 카드로 데미지가 오르면 장판도 같이 오른다
    effects: [{ kind: 'spawnZone', on: 'reflectHit', radiusU: 60, durationSec: 2, dpsRatio: 0.3 }],
  },
  E07: {
    name: '무한 검로',
    rarity: 'EPIC',
    maxStack: 1,
    // 0.04초는 아래 lockoutSec을, −25%는 둘째 effect의 value를 비춘다
    textTemplate: '재입력 불가 구간 0.04초 고정 · 반사탄 데미지 −25%',
    // §11.6 INV-1을 건너뛰는 유일한 카드다. 쿨다운이 활성 시간 + lockoutSec가 되고, INV-2는
    // 그대로 적용되므로 무적은 여전히 쿨다운 × 0.75에서 잘린다. 빈 패리에 무적이 없다는
    // §5.4가 남아 있어 연타로 버티는 행동은 성립하지 않는다.
    //
    // §19 데미지 −25%는 −20%에서 올린 값이다. 쿨다운 축을 유일하게 뚫는 카드인 만큼 대가도
    // 그만큼 커야 한다. §11.6 검산 2가 아직 −20%로 적혀 있는데 그것이 너프 이전 값이다
    effects: [
      { kind: 'invariantOverride', rule: 'INV-1', lockoutSec: 0.04 },
      { kind: 'stat', target: 'reflectDamage', op: 'addPercent', value: -25 },
    ],
  },
} as const satisfies Record<EpicCardId, CardDef>;
