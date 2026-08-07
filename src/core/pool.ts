/**
 * 사전 할당 객체 풀.
 *
 * 초당 수백 개의 탄환 객체를 만들고 버리면 GC 정지가 생기고, 정지 한 번이 프레임을
 * 건너뛰면 그건 화면에 패리 실패로 나타난다. 그래서 용량만큼을 생성 시점에 전부 만들어
 * 두고 돌려 쓴다 — 런 중에는 새 객체가 하나도 생기지 않는다.
 *
 * **활성 목록은 획득 순서를 유지한다.** 스펙 §3.2의 상한 셋 중 둘(반사탄 240, 장판 6)이
 * "가장 오래된 것부터"로 회수하므로 순서가 곧 규칙이다. 그래서 제거를 swap-with-last로
 * 접지 않는다 — 그 최적화는 순서를 지우고, 지워진 순서는 조용히 틀린 탄을 소멸시킨다.
 *
 * **상한을 넘겼을 때의 동작은 부르는 쪽이 고른다.** 05 §2가 상한 셋의 처리 방식이 전부
 * 다르다고 못 박았다 — 적 탄환은 발사 억제, 반사탄은 최오래 소멸, 잡몹은 스폰 지연이다.
 * 하나의 일반화된 "상한 처리"로 묶으면 그 차이가 지워지므로 acquire와
 * acquireRecyclingOldest를 따로 두고, 어느 쪽인지가 호출 자리에 남게 한다.
 */

export interface PoolSpec<T> {
  /** 사전 할당 개수. 이 값이 곧 동시 활성 상한이다. 1 이상이어야 한다 */
  readonly capacity: number;
  /** 생성 시점에 capacity번 불린다. 런 중에는 다시 불리지 않는다 */
  readonly create: () => T;
  /** acquire가 슬롯을 넘기기 직전에 부른다. 회수된 슬롯의 옛 값이 여기서 지워진다 */
  readonly reset: (item: T) => void;
}

export interface Pool<T> {
  readonly capacity: number;
  readonly activeCount: number;
  /**
   * 획득 순서대로 놓인 활성 목록. 가장 오래된 것이 앞이다.
   *
   * 내부 배열 그 자체를 돌려준다 — 순회 중에 acquire·release를 부르면 원소가 밀린다.
   * 순회하면서 지워야 하면 releaseWhere를 쓴다.
   */
  readonly active: readonly T[];
  /** 여유가 없으면 null. 발사 억제·스폰 지연처럼 "이번엔 안 만든다"가 답인 자리용 */
  acquire(): T | null;
  /** 여유가 없으면 가장 오래된 것을 회수해서 쓴다. 신규 요청이 실패하지 않는다 */
  acquireRecyclingOldest(): T;
  /** 활성 목록에 없던 것이면 false. 두 번 반납해도 풀이 망가지지 않는다 */
  release(item: T): boolean;
  releaseOldest(): T | null;
  /** 한 번의 순회로 조건에 맞는 것을 전부 회수하고 순서를 유지한다. 회수한 개수를 낸다 */
  releaseWhere(shouldRelease: (item: T) => boolean): number;
  releaseAll(): void;
}

class ObjectPool<T> implements Pool<T> {
  readonly capacity: number;
  private readonly resetItem: (item: T) => void;
  private readonly activeItems: T[];
  private readonly freeItems: T[];

  constructor(spec: PoolSpec<T>) {
    if (!Number.isInteger(spec.capacity) || spec.capacity < 1) {
      throw new Error(`풀 용량은 1 이상의 정수여야 한다: ${spec.capacity}`);
    }
    this.capacity = spec.capacity;
    this.resetItem = spec.reset;
    this.activeItems = [];
    this.freeItems = [];
    for (let i = 0; i < spec.capacity; i += 1) {
      this.freeItems.push(spec.create());
    }
  }

  get activeCount(): number {
    return this.activeItems.length;
  }

  get active(): readonly T[] {
    return this.activeItems;
  }

  acquire(): T | null {
    const item = this.freeItems.pop();
    if (item === undefined) {
      return null;
    }
    this.resetItem(item);
    this.activeItems.push(item);
    return item;
  }

  acquireRecyclingOldest(): T {
    if (this.freeItems.length === 0) {
      this.releaseOldest();
    }
    const item = this.acquire();
    if (item === null) {
      throw new Error('풀에서 슬롯을 얻지 못했다 — 생성자가 보장한 capacity ≥ 1이 깨졌다');
    }
    return item;
  }

  release(item: T): boolean {
    const at = this.activeItems.indexOf(item);
    if (at < 0) {
      return false;
    }
    // splice는 O(n)이다. 상한이 수백이라 값이 싸고, swap-with-last와 달리 순서를 지킨다
    this.activeItems.splice(at, 1);
    this.freeItems.push(item);
    return true;
  }

  releaseOldest(): T | null {
    const oldest = this.activeItems.shift();
    if (oldest === undefined) {
      return null;
    }
    this.freeItems.push(oldest);
    return oldest;
  }

  releaseWhere(shouldRelease: (item: T) => boolean): number {
    const active = this.activeItems;
    let kept = 0;
    for (let i = 0; i < active.length; i += 1) {
      const item = active[i]!;
      if (shouldRelease(item)) {
        this.freeItems.push(item);
      } else {
        active[kept] = item;
        kept += 1;
      }
    }
    const released = active.length - kept;
    active.length = kept;
    return released;
  }

  releaseAll(): void {
    for (const item of this.activeItems) {
      this.freeItems.push(item);
    }
    this.activeItems.length = 0;
  }
}

/**
 * capacity개를 즉시 만들어 두고 시작한다.
 *
 * 반납은 내용을 지우지 않는다 — 초기화는 다음 acquire의 reset에서 한다. 그래서 회수된
 * 슬롯이 붙들고 있는 참조(예: 유도탄이 쫓던 적)는 그 슬롯이 다시 쓰일 때까지 살아 있다.
 * 지금 규모에서는 값이 싸고, 반납 경로가 프레임마다 도는 쪽이라 거기를 비워 둔다.
 */
export function createPool<T>(spec: PoolSpec<T>): Pool<T> {
  return new ObjectPool(spec);
}
