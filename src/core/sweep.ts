/**
 * 스윕 충돌 — 한 스텝 동안 움직인 선분이 정지한 도형에 언제 닿는지.
 *
 * ── 쓰는 곳은 플레이어 피격 하나뿐이다 (12_통합_계약.md §10 E-07) ──────────────────
 *
 * 나머지 두 판정은 점 표본으로 충분하고, 그중 하나는 스윕을 쓰면 **틀린다**.
 *
 *   반사탄 대 적   한 스텝 상대 이동 23.5u에 반경 합이 최소 31u다. 못 넘는다 → 스윕 불필요
 *   패리 대상 탐색 패리 원 지름 140u에 최고 상대 이동 20u라 어떤 탄도 최소 7스텝은 원 안에
 *                 있다. 그리고 더 중요한 이유 — 스윕이 주는 것은 선분 위의 **최근접 거리**인데
 *                 스펙 §5.3은 등급을 **패리가 성립한 프레임의 거리**로 정의한다. 패리를 스윕으로
 *                 판정하면 등급이 GREAT 쪽으로 체계적으로 편향되고, 그건 최적화가 아니라
 *                 스펙 변경이다 → 스윕 금지
 *   플레이어 피격 반사탄 2400 + 이동 900 = 27.5u 상대 이동에 반경 합 16u → 필요
 *
 * ── 선분은 상대 변위다 ──────────────────────────────────────────────────────────
 *
 * 피격 스윕의 선분은 `Δ = 탄환 이동 − 플레이어 이동`이고 대상은 정지한 코어 원이다.
 * 탄환 선분 대 프레임 끝 플레이어 원으로 잡으면 둘이 마주 보고 움직일 때 최근접이 스텝
 * 중간에 생겨 여전히 뚫린다. sweepRelativeCircle·sweepRelativeBox가 그 상대 변위를 대신
 * 만들어 준다 — 호출자가 틀린 형태로 부를 수 없게 하려고 둔 것이지 편의가 아니다.
 *
 * ── 사각형이 함께 있는 이유 (12_통합_계약.md §10 E-04) ──────────────────────────
 *
 * 보스 히트박스는 원이 아니다. B3 선체 860×250과 포문 4기 96×63이 사각형이고, BossDef.hitBox ·
 * BossPartDef.hitBox가 그 값을 갖는다. 그래서 선분–원과 선분–AABB가 같은 파일에 산다.
 *
 * 두 판정 모두 정지한 물체와 겹친 채 시작하면 0을 돌려주므로, 느린 물체에서 저절로 정지
 * 판정으로 퇴화한다. 호출자는 속도를 보고 분기하지 않는다.
 */

/** 충돌 없음. 0 이상이면 스텝 안의 충돌 시각이고 [0, 1] 구간이다 */
export const NO_HIT = -1;

/**
 * 선분 대 정지 원. radiusSumU는 두 물체의 반경 합이다 — 선분 쪽은 점으로 다룬다.
 * 시작점이 이미 원 안이면 0을 돌려준다.
 */
export function sweepSegmentCircle(
  segStartXU: number,
  segStartYU: number,
  segEndXU: number,
  segEndYU: number,
  circleXU: number,
  circleYU: number,
  radiusSumU: number,
): number {
  const fromCenterXU = segStartXU - circleXU;
  const fromCenterYU = segStartYU - circleYU;
  const gap = fromCenterXU * fromCenterXU + fromCenterYU * fromCenterYU - radiusSumU * radiusSumU;
  // 시작부터 겹쳐 있다. 이 한 줄이 정지·저속 물체의 점 판정을 겸한다
  if (gap <= 0) {
    return 0;
  }

  const deltaXU = segEndXU - segStartXU;
  const deltaYU = segEndYU - segStartYU;
  const travelSq = deltaXU * deltaXU + deltaYU * deltaYU;
  // 안 움직였는데 위의 검사를 통과했다면 원 밖에 서 있는 것이다. 아래 나눗셈이 0/0이 된다
  if (travelSq === 0) {
    return NO_HIT;
  }

  const approach = 2 * (fromCenterXU * deltaXU + fromCenterYU * deltaYU);
  const discriminant = approach * approach - 4 * travelSq * gap;
  if (discriminant < 0) {
    return NO_HIT;
  }

  // 두 근 중 작은 쪽이 진입 시각이다. 큰 쪽은 관통해 나가는 시각이라 피격에는 뜻이 없다
  const entryT = (-approach - Math.sqrt(discriminant)) / (2 * travelSq);
  if (entryT < 0 || entryT > 1) {
    return NO_HIT;
  }
  return entryT;
}

/**
 * 스펙 §4.2 플레이어 피격 — 상대 변위 선분 대 정지 원.
 *
 * 선분은 `발사체 이동 − 플레이어 이동`이고 원은 원점에 놓인 반경 합이다. 네 위치는 전부
 * 같은 스텝의 이전 값과 현재 값이어야 한다. 05_시스템_설계.md §1의 8번이 발사체 적분과 함께
 * 이전 위치를 저장하는 이유가 이 인자다.
 */
export function sweepRelativeCircle(
  projectilePrevXU: number,
  projectilePrevYU: number,
  projectileXU: number,
  projectileYU: number,
  targetPrevXU: number,
  targetPrevYU: number,
  targetXU: number,
  targetYU: number,
  radiusSumU: number,
): number {
  return sweepSegmentCircle(
    projectilePrevXU - targetPrevXU,
    projectilePrevYU - targetPrevYU,
    projectileXU - targetXU,
    projectileYU - targetYU,
    0,
    0,
    radiusSumU,
  );
}

/**
 * 선분 대 정지 AABB. 박스는 중심과 반폭·반높이로 준다.
 *
 * padU는 선분 쪽 물체의 반경이다. 박스를 그만큼 부풀려 원 대 사각형을 대신한다 — 모서리에서
 * 최대 `padU × (√2 − 1)`만큼 넓게 잡히지만, 코어 10u가 선체 860×250에 붙는 경우 그 오차는
 * 4u다. 정확한 둥근 모서리를 원하면 여기가 아니라 히트박스 표를 바꿀 자리다.
 */
export function sweepSegmentBox(
  segStartXU: number,
  segStartYU: number,
  segEndXU: number,
  segEndYU: number,
  boxXU: number,
  boxYU: number,
  halfWidthU: number,
  halfHeightU: number,
  padU: number,
): number {
  const minXU = boxXU - halfWidthU - padU;
  const maxXU = boxXU + halfWidthU + padU;
  const minYU = boxYU - halfHeightU - padU;
  const maxYU = boxYU + halfHeightU + padU;

  // 원 쪽과 같은 자리의 같은 검사다. 정지·저속 물체가 여기서 점 판정으로 떨어진다
  if (
    segStartXU >= minXU &&
    segStartXU <= maxXU &&
    segStartYU >= minYU &&
    segStartYU <= maxYU
  ) {
    return 0;
  }

  const deltaXU = segEndXU - segStartXU;
  const deltaYU = segEndYU - segStartYU;
  let entryT = 0;
  let exitT = 1;

  // 축과 나란한 이동은 그 축의 나눗셈이 0/0이 된다. 슬래브 밖이면 영원히 밖이다
  if (deltaXU === 0) {
    if (segStartXU < minXU || segStartXU > maxXU) {
      return NO_HIT;
    }
  } else {
    let nearT = (minXU - segStartXU) / deltaXU;
    let farT = (maxXU - segStartXU) / deltaXU;
    if (nearT > farT) {
      const swap = nearT;
      nearT = farT;
      farT = swap;
    }
    if (nearT > entryT) {
      entryT = nearT;
    }
    if (farT < exitT) {
      exitT = farT;
    }
    if (entryT > exitT) {
      return NO_HIT;
    }
  }

  if (deltaYU === 0) {
    if (segStartYU < minYU || segStartYU > maxYU) {
      return NO_HIT;
    }
  } else {
    let nearT = (minYU - segStartYU) / deltaYU;
    let farT = (maxYU - segStartYU) / deltaYU;
    if (nearT > farT) {
      const swap = nearT;
      nearT = farT;
      farT = swap;
    }
    if (nearT > entryT) {
      entryT = nearT;
    }
    if (farT < exitT) {
      exitT = farT;
    }
    if (entryT > exitT) {
      return NO_HIT;
    }
  }

  return entryT;
}

/**
 * 스펙 §4.2 중 대상이 사각형인 경우 — 보스 본체와 B3 포문.
 * 선분과 박스의 관계는 sweepRelativeCircle과 같다: 선분이 상대 변위이고 박스는 정지해 있다.
 */
export function sweepRelativeBox(
  projectilePrevXU: number,
  projectilePrevYU: number,
  projectileXU: number,
  projectileYU: number,
  targetPrevXU: number,
  targetPrevYU: number,
  targetXU: number,
  targetYU: number,
  halfWidthU: number,
  halfHeightU: number,
  padU: number,
): number {
  return sweepSegmentBox(
    projectilePrevXU - targetPrevXU,
    projectilePrevYU - targetPrevYU,
    projectileXU - targetXU,
    projectileYU - targetYU,
    0,
    0,
    halfWidthU,
    halfHeightU,
    padU,
  );
}
