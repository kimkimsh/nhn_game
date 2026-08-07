/**
 * 설정 테이블의 타입 — config/ 전체의 계약
 *
 * config/의 모든 값 파일은 `import type { … } from './types'` 하나로 필요한 타입을 전부 얻는다.
 * 실제 정의는 주제별로 여섯 파일에 나뉘어 있고 이 파일은 그것을 다시 내보내기만 한다 —
 * 한 파일 400줄 상한(03_파일_구조.md §6) 때문이며, 나누는 축은 "누가 그 표를 고치는가"다.
 *
 * 여기 없는 테이블은 무검사 구역이다. `as const satisfies T`는 T가 있어야 성립하므로,
 * 타입 없이 선언된 표는 오타를 내도 render/나 sim/이 undefined를 만나는 순간에야 드러난다
 * (12_통합_계약.md §8-11).
 *
 * ── 여기 두지 않는 것 ──────────────────────────────────────────────────────────
 *
 * `EffectiveStats`는 sim/stats.ts가 소유한다. 카드를 §11.6의 9단계로 접은 결과이고
 * config/의 표가 아니라 런타임 스냅샷이기 때문이다. 다만 그 타입의 `clamps` 항목이 갖는
 * **네 필드 이름 `step` · `rule` · `field` · `after`는 계약이다**(12_통합_계약.md §8-17).
 * 소비자가 셋이라 그렇다 — 치트 메뉴가 그대로 표시하고(§18.4), 카드 선택 화면이 "이 카드는
 * 상한에 막혀 효과가 없다"를 여기서 읽고, tests/cards.test.ts의 검산 두 건이 어느 규칙이
 * 잘랐는지까지 대조한다. 셋이 각자 다른 이름을 기대하면 한 곳을 고칠 때 나머지 둘이 조용히
 * 어긋난다. 같은 급의 계약이 런타임 파생 넷의 시그니처다 — `reflectDamageMulFor(combo)` ·
 * `cooldownSecFor(outcome)` · `r10ActiveMinGapSec` · `shieldMaxCharges`(12 §10 E-05).
 */

export type {
  Bounds,
  PlayfieldConfig,
  PlayerConfig,
  ParryConfig,
  ParryBand,
  HardLimits,
  BulletHoming,
  BulletDef,
  ReflectConfig,
  TelegraphShapeDef,
  TelegraphConfig,
  StageScaling,
  ScoringConfig,
  ComboConfig,
  ProgressionConfig,
} from './types-gameplay';

export type {
  HitBox,
  EnemyDef,
  FormationDef,
  SquadDef,
  LanceDef,
  WaveDef,
  StageDef,
  BossPattern,
  PhaseEnterHook,
  BossPhase,
  BossPartDef,
  BossDef,
  BossCommon,
} from './types-content';

export type {
  CardEffect,
  CardDef,
  RarityWeights,
  DrawConfig,
} from './types-cards';

export type {
  HitstopConfig,
  ShakeConfig,
  KickDef,
  KickTable,
  TraumaTable,
  ParticleTier,
  ParticleConfig,
  ImpactFrameConfig,
  SpeedLineEventDef,
  SpeedLinesConfig,
  ZoneConfig,
} from './types-feel';

export type {
  Palette,
  FontStacks,
  UiBox,
  UiConfig,
} from './types-ui';

export type {
  OscWave,
  ToneDef,
  ParryVoiceDef,
  HitVoiceDef,
  AudioConfig,
  BgmStageDef,
  BgmConfig,
} from './types-audio';
