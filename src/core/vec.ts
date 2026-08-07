/**
 * 벡터 연산과 스펙 §5.5 반사 공식.
 *
 * 이 파일의 x·y는 위치(u)일 수도 속도(u/s)일 수도 있다. 그래서 인자에 단위 접미사를 붙이지
 * 않는다 — `lengthOf`가 변위에서는 u를, 속도에서는 u/s를 돌려주므로 어느 접미사를 붙여도
 * 절반은 거짓말이 된다. 단위가 하나로 정해지는 core/sweep.ts와 core/bus.ts는 U를 붙인다.
 *
 * 결과가 벡터인 함수는 전부 out 인자에 쓰고 그것을 돌려준다. 발사체 520개 × 120스텝에서
 * {x, y}를 매번 새로 만들면 그 쓰레기가 프레임 안에서 회수된다(02_아키텍처.md §5.4).
 */

/** 호출자가 미리 만들어 두고 스텝마다 재사용하는 결과 자리 */
export type Vec2 = {
  x: number;
  y: number;
};

export function createVec2(): Vec2 {
  return { x: 0, y: 0 };
}

export function setVec2(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

/**
 * Math.hypot으로 바꾸지 않는다. hypot이 막아 주는 것은 중간 제곱에서의 오버플로인데,
 * 이 게임의 좌표는 1080×1920이고 속도 상한은 2400 u/s라 제곱해도 배정도 범위 근처에 못 간다.
 */
export function lengthOf(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  return lengthSq(bx - ax, by - ay);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return lengthOf(bx - ax, by - ay);
}

/**
 * out에 단위 벡터를 쓰고 원래 길이를 돌려준다.
 * 길이가 0이면 방향이 없으므로 out은 (0, 0)이고 돌려주는 값도 0이다 — 호출자가 그 0을
 * 그대로 자기 판정에 쓸 수 있게 한 것이지 실패 신호가 아니다.
 */
export function normalizeInto(out: Vec2, x: number, y: number): number {
  const length = lengthOf(x, y);
  if (length === 0) {
    setVec2(out, 0, 0);
    return 0;
  }
  setVec2(out, x / length, y / length);
  return length;
}

/** 방향은 그대로 두고 크기만 targetLength로 바꾼다. 길이 0인 입력은 방향이 없어 (0, 0)이 된다 */
export function setLengthInto(out: Vec2, x: number, y: number, targetLength: number): Vec2 {
  const length = lengthOf(x, y);
  if (length === 0) {
    return setVec2(out, 0, 0);
  }
  const scale = targetLength / length;
  return setVec2(out, x * scale, y * scale);
}

/**
 * 단위 법선 n에 대한 거울 반사 `v' = v − 2(v·n)n`.
 * n이 단위 벡터라는 것은 타입이 못 잡는다 — normalizeInto를 거친 값만 넘긴다.
 */
export function reflectInto(out: Vec2, vx: number, vy: number, nx: number, ny: number): Vec2 {
  const projection = dot(vx, vy, nx, ny);
  return setVec2(out, vx - 2 * projection * nx, vy - 2 * projection * ny);
}

/**
 * 스펙 §5.5 패리 반사. `n = normalize(point − center)`를 만들어 out에 `v' = v − 2(v·n)n`을 쓰고
 * `v · n`을 돌려준다. sim/parry.ts는 point에 발사체 위치를, center에 플레이어 위치를 넘긴다.
 *
 * 돌려주는 값이 §5.2 C2의 접근 판정 그 자체다 — 음수일 때만 접근 중이다. 그래서 호출자는
 * 이 함수를 한 번 부르고 반환값의 부호만 보면 되고, n을 두 번 만들 일이 없다.
 *
 * point와 center가 같은 자리면 법선이 없다. 그때는 out에 v를 그대로 쓰고 0을 돌려준다 —
 * 0은 C2를 통과하지 못하므로 호출자에 별도 분기가 필요 없다.
 */
export function reflectAboutCenterInto(
  out: Vec2,
  vx: number,
  vy: number,
  pointX: number,
  pointY: number,
  centerX: number,
  centerY: number,
): number {
  const toPointX = pointX - centerX;
  const toPointY = pointY - centerY;
  const length = lengthOf(toPointX, toPointY);
  if (length === 0) {
    setVec2(out, vx, vy);
    return 0;
  }
  const nx = toPointX / length;
  const ny = toPointY / length;
  const projection = dot(vx, vy, nx, ny);
  setVec2(out, vx - 2 * projection * nx, vy - 2 * projection * ny);
  return projection;
}

/**
 * (x, y)에서 (targetX, targetY)를 보는 각 (rad).
 *
 * 이식: docs/sample_image/_shared/engine.js aimAt (1763)
 *
 * 06_렌더링과_게임필.md §6.1의 연쇄 정렬 키도 이 함수다 — 패리 지점을 앞의 두 인자에,
 * 처치 위치를 뒤의 두 인자에 넣으면 시계 방향 각도가 그대로 나온다.
 */
export function aimAt(x: number, y: number, targetX: number, targetY: number): number {
  return Math.atan2(targetY - y, targetX - x);
}

/** 각과 크기로 벡터를 만든다. aimAt의 역방향이고 보스 패턴의 spread·ring이 이것으로 발사각을 편다 */
export function fromAngleInto(out: Vec2, angleRad: number, length: number): Vec2 {
  return setVec2(out, Math.cos(angleRad) * length, Math.sin(angleRad) * length);
}
