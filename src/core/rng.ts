/**
 * 시드 난수 — mulberry32. 주입식 인스턴스다 (D-05).
 *
 * 이식: docs/sample_image/_shared/engine.js rng (81-90)
 *
 * 런 하나가 시드 하나로 재현된다. 그 시드에서 용도별 스트림을 파생시켜 쓰고,
 * **한 스트림을 여러 용도가 공유하면 안 된다** — 파티클 개수를 바꿨을 때 카드 추첨이
 * 달라진다(02 §4.1). 스트림은 최소한 sim 계열(카드 추첨·보스 난사 각도)과 render 계열
 * (파티클 지터·집중선 각도·배경 절차 생성)으로 갈리고, 그 안에서 더 잘게 나눠도 된다.
 *
 * `render/`도 자기 몫의 스트림을 받는다. 전역 난수(`Math`의 `random`)를 쓰면 09 §5의
 * 시각 회귀가 픽셀 대조를 못 하고 06 §7의 촬영 재현이 프레임 단위로 성립하지 않는다.
 *
 * **`audio/`만 그 전역 난수를 써도 된다.** 소리는 픽셀에도 판정에도 남지 않아 재현
 * 대상이 아니다. 다만 audio/가 sim 스트림에서 뽑는 것은 여전히 금지다 — 음소거 여부가
 * 난수 소비 횟수를 바꾸면 같은 시드의 두 런이 갈라진다.
 *
 * 시드 값 자체는 여기서 만들지 않는다. 만드는 자리는 `screens/`나 `dev/`다.
 *
 * **금지 API 이름을 이 파일 안에 온전한 형태로 적지 않는다.** 09 §3.6의 비결정 소스 스캔이
 * 이 파일을 소스 텍스트로 정규식 대조하므로, 주석에 적힌 이름도 코드와 똑같이 위반으로
 * 잡혀 결정론 테스트가 통째로 빨간불이 된다. 위에서 `Math`와 `random`을 붙여 쓰지 않은 것,
 * 벽시계 API를 `Date`·`performance`의 `now`라고 떼어 부르는 것이 그 이유다.
 */

/** mulberry32의 상태 증분 (engine.js:83) */
const MULBERRY32_INCREMENT = 0x6d2b79f5;

/** 32비트 정수를 [0,1)로 내리는 나눗셈 (engine.js:88) */
const UINT32_RANGE = 4294967296;

/** mulberry32의 혼합 상수 (engine.js:85-87) */
const MULBERRY32_SHIFT_A = 15;
const MULBERRY32_SHIFT_B = 7;
const MULBERRY32_SHIFT_C = 14;
const MULBERRY32_ODD_MASK = 1;
const MULBERRY32_MIX_MASK = 61;

/** FNV-1a 32비트 — 스트림 이름을 정수로 접는다 */
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** murmur3 fmix32 — 이름 해시와 런 시드를 섞어 스트림끼리 상관을 없앤다 */
const FMIX32_MULTIPLIER_A = 0x85ebca6b;
const FMIX32_MULTIPLIER_B = 0xc2b2ae35;
const FMIX32_SHIFT_A = 16;
const FMIX32_SHIFT_B = 13;

/**
 * 하나의 난수 스트림. 소비자는 이 인터페이스만 인자로 받는다.
 *
 * 같은 인스턴스를 두 용도가 나눠 쓰면 한쪽의 소비 횟수가 다른 쪽의 수열을 민다.
 * 용도가 늘면 인스턴스를 늘린다 — deriveStream은 순서와 무관하므로 공짜다.
 */
export interface Rng {
  /** [0, 1) */
  float(): number;
  /** [minInclusive, maxExclusive) 실수. 두 값이 같으면 그 값을 낸다 */
  range(minInclusive: number, maxExclusive: number): number;
  /** [minInclusive, maxExclusive) 정수. 구간에 정수가 없으면 던진다 */
  int(minInclusive: number, maxExclusive: number): number;
  /** 균등 추출. 빈 배열이면 던진다 */
  pick<T>(items: readonly T[]): T;
}

class Mulberry32 implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /**
   * 목업(engine.js:83-88)과 같은 수열을 낸다.
   *
   * 목업은 상태를 double로 무한히 키우지만 여기서는 매 스텝 32비트로 자른다. 아래 연산이
   * 전부 ToUint32/ToInt32를 거치므로 결과는 동일하고, double이 2^53을 넘겨 정밀도가
   * 무너지는 먼 미래의 절벽만 사라진다.
   */
  float(): number {
    this.state = (this.state + MULBERRY32_INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> MULBERRY32_SHIFT_A), t | MULBERRY32_ODD_MASK);
    t ^= t + Math.imul(t ^ (t >>> MULBERRY32_SHIFT_B), t | MULBERRY32_MIX_MASK);
    return ((t ^ (t >>> MULBERRY32_SHIFT_C)) >>> 0) / UINT32_RANGE;
  }

  range(minInclusive: number, maxExclusive: number): number {
    return minInclusive + this.float() * (maxExclusive - minInclusive);
  }

  int(minInclusive: number, maxExclusive: number): number {
    // 구간 안의 정수는 ceil(min) .. ceil(max)-1이다. 경계가 정수가 아니어도 이 식이 맞는다
    const lowest = Math.ceil(minInclusive);
    const count = Math.ceil(maxExclusive) - lowest;
    // `count < 1`이 아니라 부정형인 것은 NaN을 같이 걸러내기 위해서다
    if (!(count >= 1)) {
      throw new Error(`빈 정수 구간에서 뽑을 수 없다: [${minInclusive}, ${maxExclusive})`);
    }
    return lowest + Math.floor(this.float() * count);
  }

  pick<T>(items: readonly T[]): T {
    // int가 빈 구간을 던지므로 빈 배열은 여기서 걸러진다
    return items[this.int(0, items.length)]!;
  }
}

/** 이름을 32비트로 접는다. 충돌하면 두 스트림이 같은 수열을 쓰게 되므로 avalanche가 필요하다 */
function hashLabel(label: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < label.length; i += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(i), FNV_PRIME_32);
  }
  return hash >>> 0;
}

function fmix32(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> FMIX32_SHIFT_A), FMIX32_MULTIPLIER_A);
  x = Math.imul(x ^ (x >>> FMIX32_SHIFT_B), FMIX32_MULTIPLIER_B);
  return (x ^ (x >>> FMIX32_SHIFT_A)) >>> 0;
}

/** 시드에서 스트림 하나를 만든다. 파생 규칙을 거치지 않는 직접 생성이라 테스트와 재현용이다 */
export function createRng(seed: number): Rng {
  return new Mulberry32(seed);
}

/**
 * 런 시드에서 용도별 스트림을 파생한다.
 *
 * 결과는 `(runSeed, label)`만의 함수다 — 언제 몇 번째로 부르든 같은 스트림이 나온다.
 * 루트 생성기에서 순서대로 뽑아 쓰는 방식이면 안 되는 이유가 여기 있다: 그러면 render
 * 스트림을 하나 추가하는 것만으로 sim 스트림의 시드가 밀려 카드 추첨이 통째로 달라진다.
 *
 * label은 `'boss/B3/aim'`처럼 이름 공간을 나눠 써도 된다. 어떤 label이 존재하는지는
 * 게임 규칙이므로 core/가 아니라 부르는 쪽(02 §4.1)이 갖는다.
 */
export function deriveStream(runSeed: number, label: string): Rng {
  return new Mulberry32(fmix32((runSeed >>> 0) ^ hashLabel(label)));
}
