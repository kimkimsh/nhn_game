/**
 * 게임 전체가 공유하는 식별자 — 스펙 §6.1 · §8.1 · §8.2 · §10 · §11
 *
 * 여기 없는 문자열은 어디에도 쓸 수 없다. 잡몹을 추가하려면 먼저 EnemyId에 줄을 넣어야 하고,
 * 그 순간 enemies.ts가 "그 ID의 정의가 없다"고 에러를 낸다. 정의를 빠뜨린 채 배치만 하는 실수가
 * 구조적으로 불가능해진다.
 */

/** §6.1 탄환 12종 */
export type BulletId =
  | 'P1'  | 'P2'  | 'P3'  | 'P4'  | 'P5'  | 'P6'
  | 'P7'  | 'P8'  | 'P9'  | 'P10' | 'P11' | 'P12';

/** §6.1 중 패리 가능한 것만. P9 화염 장판과 P12 관통 대창은 제외된다 */
export type ParryableBulletId = Exclude<BulletId, 'P9' | 'P12'>;

/**
 * 탄환 실루엣 키 — 목업 engine.js:40-52의 shape 열
 *
 * BulletId와 1:1이지만 별개 축이다. drawBullet의 case(engine.js:203-269)와 P1의 스프라이트
 * 굽기가 이 값으로 분기하고, 굽기 대상은 10종뿐이다 — 'zone'과 'lance'는 case가 없다(12 §1 C-04).
 */
export type BulletShapeId =
  | 'dot'   | 'shard' | 'fireshard' | 'needle' | 'dart' | 'star'
  | 'crescent' | 'orb' | 'bomb'     | 'seeker' | 'zone' | 'lance';

/** §8.1 잡몹 아키타입 9종 */
export type EnemyId =
  | 'E-A'  // 조총병
  | 'E-B'  // 궁병
  | 'E-C'  // 방패병
  | 'E-D'  // 돌격병
  | 'E-E'  // 화포병
  | 'E-F'  // 척후
  | 'E-G'  // 신관
  | 'E-H'  // 화전병
  | 'E-I'; // 함포문

/**
 * 잡몹 실루엣 키 — 12_통합_계약.md §8-10
 *
 * 스펙이 아니라 render/enemy.ts의 drawEnemy가 분기하는 값이다(목업 engine.js:436의 shape 분기).
 * EnemyId와 1:1이 아니다 — 재사용이 목적이므로 두 아키타입이 같은 키를 가질 수 있다.
 */
export type EnemySpriteId =
  | 'gunner' | 'archer'  | 'shield'     | 'charger' | 'cannoneer'
  | 'scout'  | 'priest'  | 'firearcher' | 'port';

/**
 * 보스 실루엣 키 — 목업 engine.js:65-69의 shape 열
 *
 * BossId와 1:1이 아니다. B5 기함과 B3 아타케부네가 둘 다 'warship'을 쓰고, B5 갑판에 얹히는
 * 총대장 본체는 B2와 같은 'samurai'다(10_boss5_flagship/scene.js:13-14).
 */
export type BossSpriteId = 'commander' | 'samurai' | 'warship' | 'artillery';

/**
 * 잡몹 행동 종류 — 05_시스템_설계.md §6.2
 *
 * EnemyDef.behavior가 고르는 값이고 sim/enemies.ts가 이 여섯 갈래로 분기한다.
 * union이 아니면 오타가 "아무 행동도 안 하는 적"으로 나타나고 컴파일은 통과한다.
 */
export type EnemyBehaviorId =
  | 'holdAndFire'    // E-A · E-E · E-G · E-H
  | 'strafeAndFire'  // E-B
  | 'descend'        // E-C
  | 'charge'         // E-D
  | 'crossPass'      // E-F. 정지하지 않는다
  | 'mounted';       // E-I

/**
 * 예고 표시 3종 — 스펙 §6.2 HR-05
 *
 * HR-05가 예고를 이 셋으로 못 박았다. 넷째를 넣으려면 스펙 §2를 먼저 바꿔야 한다.
 * 'dash'는 돌진 방향선이고 이름이 04_밸런스_데이터_설계.md §5의 E-D 항목에서 왔다.
 */
export type TelegraphId =
  | 'impactCircle'  // 곡사 P7 착탄 예고 원. 1.2초 고정
  | 'pierceLine'    // 관통 대창 P12 폭 40u 예고선. 0.8초 고정
  | 'dash';         // 본체 돌진 방향선. 1.0초 고정

/** §8.2 진입 형태 6종 */
export type FormationId = 'F-1' | 'F-2' | 'F-3' | 'F-4' | 'F-5' | 'F-6';

/** §9.2 스테이지 5개 */
export type StageId = 1 | 2 | 3 | 4 | 5;

/**
 * 배경 키 — §9.2. render/backgrounds/*.ts의 파일명과 1:1이다
 *
 * StageId로 배경을 고르지 않는 이유는 배경 함수의 소유자가 스테이지 정의(P2-6·P2-7)가 아니라
 * P4-9~11이기 때문이다. 이름으로 이으면 스테이지 순서를 바꿔도 배경 매핑이 안 깨진다.
 */
export type BackgroundId =
  | 'busanjin' | 'dongnaeseong' | 'hansando' | 'haengju' | 'noryang';

/** §10 보스 5기 */
export type BossId = 'B1' | 'B2' | 'B3' | 'B4' | 'B5';

/** §5.3 패리 등급 3단 */
export type ParryGradeId = 'GREAT' | 'GOOD' | 'NOT_BAD';

/** §11.2 카드 등급 */
export type CardRarity = 'NORMAL' | 'RARE' | 'EPIC';

/** §11.3 노말 14종 */
export type NormalCardId =
  | 'N01' | 'N02' | 'N03' | 'N04' | 'N05' | 'N06' | 'N07'
  | 'N08' | 'N09' | 'N10' | 'N11' | 'N12' | 'N13' | 'N14';

/** §11.4 레어 10종 */
export type RareCardId =
  | 'R01' | 'R02' | 'R03' | 'R04' | 'R05'
  | 'R06' | 'R07' | 'R08' | 'R09' | 'R10';

/** §11.5 에픽 7종 */
export type EpicCardId = 'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06' | 'E07';

export type CardId = NormalCardId | RareCardId | EpicCardId;

/**
 * §11.2 제시 풀에서 빼는 조건. "효과가 무의미한 경우"의 실제 목록이다
 *
 * 최대 중첩 도달과 중첩 불가 보유는 CardDef.maxStack이 이미 표현하므로 여기 없다.
 * 남는 것은 런 상태를 봐야 아는 것뿐이고, 지금은 N14 하나다.
 */
export type CardHideCondition = 'lifeAtMax';

/**
 * §11.3~§11.5 카드가 바꾸는 수치의 이름 — CardEffect의 kind 'stat'이 고른다
 *
 * 31종 중 24종의 효과가 "이 목록 중 하나를 한 숫자만큼 바꾼다"로 끝난다. 나머지는 숫자 하나로
 * 표현되지 않아 types.ts의 CardEffect가 각자 kind를 갖는다.
 * sim/stats.ts의 §11.6 9단계가 이 이름들을 그대로 스냅샷 필드에 매핑한다.
 */
export type StatTarget =
  | 'reflectDamage'          // N01 · E07
  | 'reflectSpeed'           // N06
  | 'reflectPierce'          // R02
  | 'reflectHitRadius'       // N12. 적 명중 판정만. 플레이어 피격 판정은 원래 크기다(§11.3)
  | 'reflectHomingDegPerSec' // R03
  | 'moveSpeed'              // N02
  | 'parryRadius'            // N03 · R09
  | 'parryCooldown'          // N04
  | 'parryActive'            // N05
  | 'parryInvuln'            // N10
  | 'whiffCooldown'          // N13. 빈 패리 전용 쿨다운 — 정상 쿨다운과 별개 값이다
  | 'hitInvuln'              // N09
  | 'greatBandMaxDist'       // N08 · R09 · E05
  | 'goodBandMaxDist'        // N07
  | 'greatDamageMul'         // E05. op가 'set'인 유일한 자리다
  | 'comboHold'              // N11
  | 'maxLife';               // R06
