/**
 * 피드백 이벤트 버스 — sim이 일으킨 사건을 그림과 소리로 넘기는 유일한 통로.
 *
 * sim/은 소리를 낼 수 없고 파티클도 만들 수 없다(03_파일_구조.md §5). 그런데 스펙 §17의
 * 사건들은 전부 sim 안에서 일어난다. 그 둘을 잇는 것이 이 파일이다.
 *
 * ── 범용 pub-sub이 아니다 ───────────────────────────────────────────────────────
 *
 * FeedbackEvent는 고정된 union이다. 새 사건을 내려면 먼저 이 타입에 줄을 넣어야 하고, 그
 * 순간 구독자 셋이 그 kind를 처리하지 않는다는 사실이 드러난다. 07_오디오_설계.md §1.2가
 * 이 구조에 기대는 것이 하나 있다 — **소리만 있고 그림이 없는 사건은 타입을 고쳐야만 만들 수
 * 있으므로 실수로는 생기지 않는다.**
 *
 * 구독자는 셋이다. render/particles.ts(파티클·팝업) · render/camera.ts(trauma·킥) ·
 * audio/sfx.ts(소리). 셋이라서 버스가 정당화된다 — 하나였다면 직접 호출이 맞다.
 *
 * ── 페이로드를 정하는 기준 ──────────────────────────────────────────────────────
 *
 * audio/는 sim/을 import할 수 없다(03 §5). 그래서 **소리가 필요로 하는 값은 전부 이벤트에
 * 실려야 한다** — 등급, 콤보 수, 예비동작 길이가 필드로 있는 이유가 그것이다.
 * render/는 world를 읽을 수 있으므로 상시 상태는 싣지 않는다. 대신 **프레임이 끝나면 사라지는
 * 것**은 싣는다: 처치 좌표, 패리 좌표, 킥 방향은 다음 프레임에 world 어디에도 없다.
 *
 * ── config/ids.ts를 import하지 않는다 ───────────────────────────────────────────
 *
 * core/는 완전 독립이다(03 §5, eslint.config.js가 강제). 그래서 ParryGrade와 TelegraphShape는
 * config/ids.ts의 ParryGradeId · TelegraphId와 **같은 문자열을 여기 다시 적는다.** 두 곳이
 * 어긋나면 sim/이 emit하는 자리에서 컴파일 에러가 난다 — 조용히 갈라지지 않는다.
 * 대신 EnemyId·BossId는 필드로 두지 않았다. 구독자 셋 중 누구도 그 값으로 갈라지지 않고
 * (06 §6·07 §3.0), 실으려면 union 14개를 여기 복사해야 한다. 필요해지면 그때 줄을 넣는다.
 *
 * ── 스텝 안에서 쌓고 스텝이 끝나면 비운다 ───────────────────────────────────────
 *
 * emit은 큐에만 넣는다. 05_시스템_설계.md §1의 17번(이벤트 큐 배출)이 flush를 부른다.
 * sim 도중에 소비하면 구독자가 sim 상태를 중간에 읽게 되고, 그러면 같은 입력이 스텝 내부
 * 순서에 따라 다른 결과를 낸다 — D-05의 결정론이 sim 밖에서 깨지는 경로다.
 */

/** config/ids.ts의 ParryGradeId와 같은 값이다 (파일 머리말 참고) */
export type ParryGrade = 'GREAT' | 'GOOD' | 'NOT_BAD';

/** config/ids.ts의 TelegraphId와 같은 값이다. HR-05가 예고를 이 셋으로 못 박았다 */
export type TelegraphShape = 'impactCircle' | 'pierceLine' | 'dash';

/** 스펙 §4.2. 피격음과 화면 플래시가 원인별로 갈린다 — §17이 "구분되어야 한다"고 요구한다 */
export type PlayerHitCause = 'enemyBullet' | 'reflectedBullet' | 'body' | 'zone';

/** 스펙 §4.2 피격 무적 1.5초와 §5.1 패리 무적 0.14초. 소리는 앞의 것에만 붙는다(07 §3.15) */
export type InvulnSource = 'playerHit' | 'parry';

/**
 * 스펙 §17이 요구한 사건 전부.
 *
 * §17의 17행 중 넷은 여기 없다. 사건이 아니라 **상태**여서 render가 world를 읽으면 그만이고,
 * 07 §3.15가 그 넷에 소리를 주지 않기로 이미 판정했다.
 *   히트스톱          parry·playerHit의 등급이 정지 길이를 정한다. 정지에 소리를 얹으면 모순이다
 *   반사탄의 위험성   상시 상태다. 색(황핵·적링)이 맡는다
 *   자해 유예         발사체가 들고 있는 잔여 시간이라 render가 그대로 읽어 색으로 그린다
 *   패리 불가 대상    형태로 구분한다. §17이 "색만으로 구분하지 않는다"고 수단까지 지정했다
 */
export type FeedbackEvent =
  // 패리 — 스펙 §5
  /**
   * 활성 구간에서 발사체가 1개 이상 패리된 스텝. 활성 구간당 최대 1회다.
   * grade는 §5.3이 말하는 최고 등급이고, count는 이번에 처리한 발사체 수다(§6.2의 ×N).
   * combo는 §12.2로 오른 뒤의 값이다 — 07 §3.14의 음정 `360 + combo × 16`이 이것을 읽는다.
   */
  | {
      readonly kind: 'parry';
      readonly parrySeq: number;
      readonly grade: ParryGrade;
      readonly count: number;
      readonly combo: number;
      readonly xU: number;
      readonly yU: number;
    }
  /** §5.4 활성 구간이 패리 0개로 끝났다. 무적이 안 붙었다는 사실이 이 신호의 전부다 */
  | { readonly kind: 'parryWhiff'; readonly xU: number; readonly yU: number }
  /**
   * §7.4 반사탄을 다시 쳐냈다. 발사체 하나마다 한 번이다 — prevGrade가 그 발사체의 직전
   * 등급이라 여러 발을 묶으면 뜻을 잃는다. `grade`가 `prevGrade`보다 높은 경우가 §17이 말한
   * "데미지가 올랐다는 사실"이고, 07 §3.3의 상승 아르페지오가 거기서만 울린다.
   */
  | {
      readonly kind: 'reparry';
      readonly grade: ParryGrade;
      readonly prevGrade: ParryGrade;
      readonly xU: number;
      readonly yU: number;
    }
  /**
   * 발사체 하나가 반사탄이 됐다. 재패리로 다시 반사된 것도 포함한다.
   * parry와 따로 있는 이유는 게인이 **그 발사체의** 등급에 걸리기 때문이다(07 §3.0) —
   * parry는 최고 등급 하나만 싣는다.
   */
  | {
      readonly kind: 'reflectLaunched';
      readonly grade: ParryGrade;
      readonly xU: number;
      readonly yU: number;
    }
  /** §5.1 쿨다운이 끝나 다시 누를 수 있다. 초당 4회 이상 반복되므로 trauma가 0이다 */
  | { readonly kind: 'cooldownReady' }
  /** §17 무적 종료. 07 §3.15가 패리 무적에는 소리를 안 붙이기로 했으므로 source로 가른다 */
  | { readonly kind: 'invulnEnded'; readonly source: InvulnSource }

  // 반사탄이 만든 결과 — 스펙 §7
  /** 반사탄이 적에 맞았지만 죽이지는 못했다. §17의 "반사탄이 유효했다"가 처치 전에도 읽혀야 한다 */
  | { readonly kind: 'reflectHit'; readonly xU: number; readonly yU: number }
  /** §7.3 방패병 정면. 아무 일도 안 일어났다는 것이 정보라서 약한 신호를 준다 */
  | { readonly kind: 'shieldBlocked'; readonly xU: number; readonly yU: number }
  /**
   * 잡몹 처치. 보스와 보스 부위는 따로 있다.
   *
   * chainIndex의 단위는 반사탄 하나가 아니라 **패리 이벤트 하나**다(12_통합_계약.md §6).
   * 한 번의 패리가 반사한 탄들이 잡은 적에 0, 1, 2가 붙고 render가 그만큼 지연시켜
   * 동시 삭제가 아니라 순차 연쇄로 보이게 한다.
   *
   * parrySeq는 그 처치가 어느 패리에서 나왔는지다. 없으면 두 패리의 연쇄가 시간상 겹쳤을 때
   * render가 어느 큐에 넣을지 가릴 수 없다 — 반사탄은 반사된 뒤 몇 초를 더 날아간다.
   *
   * 연쇄의 길이는 싣지 않는다. 명중이 시간에 흩어져 도착하므로 sim이 emit하는 시점에
   * 그 값을 모른다. "마지막 링크"는 큐가 마르는 것으로 render가 판단한다.
   */
  | {
      readonly kind: 'enemyKilled';
      readonly parrySeq: number;
      readonly chainIndex: number;
      readonly xU: number;
      readonly yU: number;
    }

  // 플레이어 — 스펙 §4
  /**
   * §4.2 피격. dirX·dirY는 맞힌 발사체의 진행 방향(단위 벡터)이고 render/camera.ts의 킥이
   * 그 방향으로 밀린다. 발사체는 이 스텝에 사라지므로 다음 프레임에는 어디서도 못 읽는다.
   */
  | {
      readonly kind: 'playerHit';
      readonly cause: PlayerHitCause;
      readonly xU: number;
      readonly yU: number;
      readonly dirX: number;
      readonly dirY: number;
    }
  /** §4.3 코어가 장판에 들어간 스텝. 0.5초 간격 반복 판정마다가 아니라 진입 1회다 */
  | { readonly kind: 'zoneEntered'; readonly xU: number; readonly yU: number }

  // 적과 보스 — 스펙 §6.2 · §10
  /**
   * §6.2 발사 예비동작 시작. durationSec은 스테이지별 예비동작 길이이고 소리가 그 길이만큼
   * 이어진다(07 §3.9). HR-05가 궤적 예고를 금지했으므로 "곧 쏜다"를 전하는 것이 이것뿐이다.
   */
  | {
      readonly kind: 'enemyWindup';
      readonly xU: number;
      readonly yU: number;
      readonly durationSec: number;
    }
  /** §6.2 HR-05가 허용한 예고 셋. 셋이 서로 다른 소리를 내므로 shape가 필요하다(07 §3.10) */
  | {
      readonly kind: 'telegraph';
      readonly shape: TelegraphShape;
      readonly xU: number;
      readonly yU: number;
    }
  /** §10.1 페이즈 전환 연출 시작. 집중선이 보스 중심으로 수렴하므로 좌표가 필요하다 */
  | {
      readonly kind: 'bossPhase';
      readonly phase: number;
      readonly xU: number;
      readonly yU: number;
    }
  /** §10.4 B3 포문 파괴. 이 보스의 유일한 새 축이라 처치와 다른 신호를 준다 */
  | { readonly kind: 'bossPartBroken'; readonly xU: number; readonly yU: number }
  /** §10 보스 돌진이 착지했다. dirX·dirY는 돌진 방향이고 킥이 그쪽으로 밀린다 */
  | {
      readonly kind: 'bossChargeLand';
      readonly xU: number;
      readonly yU: number;
      readonly dirX: number;
      readonly dirY: number;
    }
  /** §10.1 격파 연출 시작 */
  | { readonly kind: 'bossDefeated'; readonly xU: number; readonly yU: number }

  // 점수 — 스펙 §12
  /** §12.2 콤보 유지 시간이 COMBO_WARN_SEC 아래로 내려간 스텝. 3핍 경고 한 벌을 낸다 */
  | { readonly kind: 'comboWarn' }

  // 화면 — 스펙 §16.2. 발행자가 sim이 아니라 screens/다
  /**
   * 카드 선택 화면의 조작음. sim 밖에서 나므로 flush도 screens/가 부른다.
   * 여기 있는 이유는 audio/sfx.ts가 버스 말고는 발화 경로를 갖지 않기 때문이다(07 §1.2).
   */
  | { readonly kind: 'uiCursorMove' }
  | { readonly kind: 'uiReroll' }
  | { readonly kind: 'uiConfirm' };

export type FeedbackEventKind = FeedbackEvent['kind'];

/** kind 하나에 대응하는 이벤트 타입. 구독자와 테스트가 좁혀진 타입을 적을 때 쓴다 */
export type FeedbackEventOf<K extends FeedbackEventKind> = Extract<FeedbackEvent, { kind: K }>;

export type FeedbackListener<K extends FeedbackEventKind> = (event: FeedbackEventOf<K>) => void;

/** 구독 해제. 두 번 불러도 안전하다 */
export type Unsubscribe = () => void;

export interface FeedbackBus {
  on<K extends FeedbackEventKind>(kind: K, listener: FeedbackListener<K>): Unsubscribe;
  /** 큐에 넣기만 한다. 구독자는 flush 전까지 아무것도 못 본다 */
  emit(event: FeedbackEvent): void;
  /** 쌓인 것을 emit 순서대로 한 번에 넘긴다. sim 스텝의 마지막 동작이다(05 §1의 17번) */
  flush(): void;
  /** 큐와 구독을 전부 버린다. 테스트가 케이스 사이에 부른다 */
  reset(): void;
}

type AnyListener = (event: FeedbackEvent) => void;

function createFeedbackBus(): FeedbackBus {
  /**
   * 빈 자리는 null로 남긴다. dispatch 도중에 자기 자신을 해제하는 구독자가 있어도 배열이
   * 밀리지 않아 다음 구독자를 건너뛰지 않는다. 구독자가 셋뿐이라 구멍은 쌓이지 않는다.
   */
  const listeners = new Map<FeedbackEventKind, Array<AnyListener | null>>();
  /**
   * 두 배열을 번갈아 쓴다. flush마다 새 배열을 만들면 초당 120번의 쓰레기가 되고,
   * 배출 중에 들어온 emit이 같은 배열에 붙으면 순회가 끝나지 않는다.
   */
  let queue: FeedbackEvent[] = [];
  let spare: FeedbackEvent[] = [];

  function dispatch(event: FeedbackEvent): void {
    const slots = listeners.get(event.kind);
    if (slots === undefined) {
      return;
    }
    for (let index = 0; index < slots.length; index += 1) {
      const listener = slots[index];
      if (listener !== null && listener !== undefined) {
        listener(event);
      }
    }
  }

  return {
    on<K extends FeedbackEventKind>(kind: K, listener: FeedbackListener<K>): Unsubscribe {
      let slots = listeners.get(kind);
      if (slots === undefined) {
        slots = [];
        listeners.set(kind, slots);
      }
      // dispatch가 kind로 고른 뒤에만 부르므로 실제로 넘어가는 값은 언제나 FeedbackEventOf<K>다.
      // 그 사실은 Map 하나에 모든 kind를 담는 한 타입으로 표현되지 않는다
      const stored = listener as AnyListener;
      const slot = slots.length;
      const owned = slots;
      slots.push(stored);
      return () => {
        if (owned[slot] === stored) {
          owned[slot] = null;
        }
      };
    },

    emit(event: FeedbackEvent): void {
      queue.push(event);
    },

    flush(): void {
      if (queue.length === 0) {
        return;
      }
      const batch = queue;
      queue = spare;
      spare = batch;
      for (let index = 0; index < batch.length; index += 1) {
        const event = batch[index];
        if (event !== undefined) {
          dispatch(event);
        }
      }
      batch.length = 0;
    },

    reset(): void {
      queue.length = 0;
      spare.length = 0;
      listeners.clear();
    },
  };
}

/**
 * 게임 전체가 쓰는 하나뿐인 버스.
 *
 * 인스턴스를 여럿 만들 수 있게 하지 않는다 — 구독자가 서로 다른 버스에 붙으면 소리만 나고
 * 그림이 없는 사건이 생기고, 07 §1.2가 이 파일에 기대는 보장이 바로 그것이 불가능하다는 것이다.
 */
export const bus: FeedbackBus = createFeedbackBus();
