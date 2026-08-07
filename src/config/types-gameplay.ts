/**
 * 규칙 수치 테이블의 타입 — 스펙 §3 · §4 · §5 · §6 · §7 · §12 · §13 · §14.1
 *
 * 값을 하나도 담지 않는다. 담는 것은 "그 표가 어떤 칸을 갖는가"뿐이고, 값은 각 테이블 파일에 있다.
 * 여기 빠진 칸은 그 테이블의 무검사 구역이 된다 — as const satisfies는 타입이 있어야 성립한다
 * (12_통합_계약.md §8-11).
 *
 * 배럴은 ./types이며 config/의 다른 파일은 이 파일을 직접 import하지 않는다.
 */
import type { BulletShapeId, StageId, TelegraphId } from './ids';

/** 축정렬 사각 영역. 스펙 §3.1이 좌표를 x·y 구간으로 적으므로 그 모양 그대로 둔다 */
export type Bounds = {
  readonly minXU: number;
  readonly maxXU: number;
  readonly minYU: number;
  readonly maxYU: number;
};

/**
 * §3.1 좌표계 · §3.2 전역 상한
 *
 * 동시 적 탄환 상한은 여기 없다. 스테이지마다 다른 값이라 difficulty.ts의
 * maxEnemyBullets가 유일 소스다(12_통합_계약.md §10 E-13).
 */
export type PlayfieldConfig = {
  readonly widthU: number;
  readonly heightU: number;
  readonly playerBounds: Bounds;
  readonly enemyBounds: Bounds;
  /** 돌격형 적만 이 y까지 내려온다. 나머지는 enemyBounds.maxYU에서 멈춘다 */
  readonly chargerMaxYU: number;
  readonly bossHomeBounds: Bounds;
  /** 발사체 소멸 경계. 플레이필드 외곽에서 이만큼 더 나가면 지운다 */
  readonly despawnMarginU: number;
  readonly maxReflectBullets: number;
  readonly maxEnemies: number;
};

/**
 * §4.1 기본 파라미터 · §4.2 피격 처리
 *
 * 피격 히트스톱은 여기 없다. feel.ts의 playerHit이 유일 소스다(12_통합_계약.md §10 E-13).
 */
export type PlayerConfig = {
  readonly moveSpeedUPerSec: number;
  /** §4.1 피격 판정 반경. 화면의 코어 점 크기와 1:1이다 — 둘이 갈리면 §17이 깨진다 */
  readonly hitRadiusU: number;
  /** §4.1 시각적 크기. 판정과 무관하다 */
  readonly visualSizeU: number;
  readonly startLife: number;
  readonly maxLife: number;
  readonly hitInvulnSec: number;
  /** §4.2 2단계. 피격 시 이 반경 안의 적 탄환만 지운다. 반사탄은 지우지 않는다 */
  readonly hitClearRadiusU: number;
};

/**
 * §5.1 패리 파라미터
 *
 * lockoutSec는 없다. cooldownSec − activeSec이므로 저장하지 않고 유도한다(12_통합_계약.md §5).
 * graceSec도 없다 — 자해 유예는 반사탄이 들고 다니는 상태라 ReflectConfig가 갖는다
 * (04_밸런스_데이터_설계.md §4-B).
 */
export type ParryConfig = {
  readonly radiusU: number;
  readonly activeSec: number;
  /** 활성 시작 시점 기준. 여기서 나오는 sim 초당 4.16회는 실시간 체감값이 아니다(12 §10 E-02) */
  readonly cooldownSec: number;
  readonly bufferSec: number;
  /** 패리가 성립했을 때만 부여된다. 빈 패리는 무적이 없다(§5.4) */
  readonly invulnSec: number;
};

/**
 * §5.3 등급 밴드 한 줄
 *
 * maxDistU가 number | null인 것이 이 타입의 전부다. 마지막 밴드는 null이고 "패리 반경까지"를
 * 뜻하며 sim/stats.ts가 스냅샷을 만들 때 실효 parryRadiusU로 채운다. 70을 박아 두면 카드로
 * 반경이 106u가 됐을 때 70 < d ≤ 106에 등급 없는 고리가 생기고, 등급이 없으면 데미지 배수·
 * 히트스톱·점수·무적이 전부 미정의다(12_통합_계약.md §10 E-06).
 */
export type ParryBand = {
  readonly id: 'GREAT' | 'GOOD' | 'NOT_BAD';
  readonly maxDistU: number | null;
  readonly damageMul: number;
  readonly speedMul: number;
  /** §5.3 등급별 히트스톱의 단일 소스다. feel.ts는 이 세 값을 갖지 않는다(12 §5) */
  readonly hitstopSec: number;
  /**
   * 히트스톱이 시작될 때의 진동 진폭 (u). render 변위에만 쓰고 판정은 움직이지 않는다.
   *
   * 등급 구분이 길이만으로는 안 읽히기 때문에 있다 — NOT BAD의 0.02초는 60Hz에서 한두 프레임이라
   * 설계된 체감 비율이 화면에서 뭉개진다(12 §8-3).
   */
  readonly shakeAmplitudeU: number;
  readonly score: number;
};

/** §11.6 어떤 카드 조합으로도 넘을 수 없는 상한 */
export type HardLimits = {
  readonly cooldownMinSec: number;
  readonly parryRadiusMaxU: number;
  readonly moveSpeedMaxUPerSec: number;
  readonly reflectSpeedMaxUPerSec: number;
};

/** §6.1 P11 유도탄 전용. 반사되는 순간 sim/reflect.ts가 남은 유도 시간을 0으로 만든다 */
export type BulletHoming = {
  readonly durationSec: number;
  readonly turnRateDegPerSec: number;
  /** 유도가 끝난 뒤의 직진 속도. speedUPerSec와 다른 값이다 */
  readonly exitSpeedUPerSec: number;
};

/**
 * §6.1 탄환 한 종
 *
 * speedUPerSec는 스테이지 1 기준이다. 실제 탄속 = 이 값 × difficulty.ts의 bulletSpeedMul.
 * brp는 반사탄 데미지의 기준값이고 재패리해도 언제나 여기서 다시 시작한다(§7.2).
 */
export type BulletDef = {
  readonly name: string;
  readonly radiusU: number;
  readonly speedUPerSec: number;
  readonly isParryable: boolean;
  readonly brp: number;
  readonly shape: BulletShapeId;
  readonly note: string;
  readonly homing?: BulletHoming;
};

/** §7.1 반사탄의 일생 */
export type ReflectConfig = {
  /** 반사 성립 후 이 시간 동안 피격도 패리도 판정하지 않는다. 재패리마다 새로 시작한다(§7.4) */
  readonly graceSec: number;
  readonly lifetimeSec: number;
  readonly speedMaxUPerSec: number;
  /** 기본 관통 수. 0이면 적 1기 명중 시 소멸한다 */
  readonly pierceCount: number;
  /** §7.4 재패리 점수는 등급 점수의 이 비율이다 */
  readonly scoreRatio: number;
};

/** §6.2 예고 도형 하나 */
export type TelegraphShapeDef = {
  readonly name: string;
  /** 도형이 떠 있는 시간. 이 시간이 지나면 판정이 발생한다 */
  readonly durationSec: number;
  /** 판정이 지속되는 시간. 순간 판정이면 null (착탄 원·돌진 방향선) */
  readonly activeSec: number | null;
};

/**
 * §6.2 예고 3종 · HR-09 발사 억제
 *
 * 확산·링(0.4초)과 참격파 백스윙(0.7초)은 예고가 아니라 예비동작이라 여기 없다 —
 * difficulty.ts가 갖는다(04_밸런스_데이터_설계.md §6). 단발 직선의 예비동작도 스테이지별이라
 * 같은 파일의 tellSec이다.
 */
export type TelegraphConfig = {
  readonly shapes: { readonly [K in TelegraphId]: TelegraphShapeDef };
  /**
   * HR-09 최소 비행 시간. 억제 거리 = 실제 탄속 × 이 값이고, 플레이어가 그보다 가까우면
   * 그 발사는 취소되고 다음 주기를 기다린다. 예고 도형이 붙은 공격은 억제 대상이 아니다
   * (05_시스템_설계.md §8.2).
   */
  readonly minFlightSec: number;
};

/**
 * §14.1 스테이지 한 칸
 *
 * bossHp와 peakEnemies는 없다. 보스 HP는 BossDef.hp가 유일 소스이고, 잡몹 피크는 편성이
 * 실제로 도달하는 값이라 헤드리스 리포트가 계산한다(12_통합_계약.md §5).
 */
export type StageScaling = {
  readonly enemyHpMul: number;
  readonly bulletSpeedMul: number;
  /** 단발 직선의 발사 예비동작. 확산·링·참격파는 스테이지와 무관하게 고정이다(§6.2) */
  readonly tellSec: number;
  /** §3.2 동시 적 탄환 상한의 유일한 소스. playfield.ts는 이 값을 갖지 않는다(12 §10 E-13) */
  readonly maxEnemyBullets: number;
  readonly waveCount: number;
  readonly targetLengthSec: number;
  readonly unparryable: 'none' | 'zone' | 'zone+lance';
};

/**
 * §12.1 점수
 *
 * 등급별 패리 점수는 여기 없다 — ParryBand.score가 유일 소스다. 잡몹 처치 점수도 없다 —
 * EnemyDef.score가 갖는다.
 */
export type ScoringConfig = {
  readonly reparryRatio: number;
  readonly bossPhaseChange: number;
  readonly bossKill: number;
  /** 스테이지 클리어 보너스 = 남은 라이프 × 이 값. S5에도 걸린다 */
  readonly stageClearPerLife: number;
};

/** §12.2 콤보 */
export type ComboConfig = {
  /** 마지막 패리 성공 후 유지 시간. N11이 늘린다 — HUD 게이지의 분모는 이 상수가 아니라 실효값이다 */
  readonly holdSec: number;
  readonly multStep: number;
  readonly multPerStep: number;
  readonly multMax: number;
};

/**
 * §13 런의 생명주기
 *
 * 값이 아니라 규칙을 담는 표다. 이 게임에는 난이도 선택도 중간 저장도 없고(§13.1·§13.3),
 * 그 사실이 코드 곳곳의 if로 흩어지지 않게 한 곳에 모아 둔다.
 */
export type ProgressionConfig = {
  readonly stageCount: number;
  readonly restartStageId: StageId;
  /** §13.2 라이프는 5스테이지를 관통해 공유되고 클리어로 회복되지 않는다 */
  readonly lifeCarriesAcrossStages: boolean;
  /** §13.3 게임오버 시 획득 카드 전부 소실 */
  readonly cardsLostOnGameOver: boolean;
  /** §11.1 리롤 사용 여부도 함께 초기화된다 */
  readonly rerollResetOnGameOver: boolean;
  /** §12.2 콤보는 스테이지를 넘어 유지되지 않는다 */
  readonly comboResetOnStageStart: boolean;
};
