/**
 * render/camera.ts — 06 §4.2의 세 규칙이 실제로 성립하는지.
 *
 * 픽셀은 09 §5의 시각 회귀가 본다. 여기서 보는 것은 픽셀이 아니라 **숫자로만 확인되는 셋**이다:
 * trauma가 오르고 감쇠해 0으로 돌아오는가, 12 §7.3의 연쇄 상한이 실제로 화면을 내려앉히는가,
 * prefers-reduced-motion이 변위를 정말 0으로 만드는가.
 */
import { describe, expect, it } from 'vitest';
import { createCamera } from '../src/render/camera';
import { bus } from '../src/core/bus';
import { createRng } from '../src/core/rng';
import { TRAUMA_ON, SHAKE } from '../src/config/feel';

describe('camera', () => {
  it('trauma가 오르면 변위가 생기고 감쇠하면 0으로 돌아온다', () => {
    bus.reset();
    const cam = createCamera({ bus, rng: createRng(1) });
    cam.update(1 / 60);
    expect(cam.offsetXU).toBe(0);
    bus.emit({ kind: 'playerHit', cause: 'enemyBullet', xU: 0, yU: 0, dirX: 1, dirY: 0 });
    bus.flush();
    expect(cam.trauma).toBeCloseTo(TRAUMA_ON.playerHit, 6);
    cam.update(1 / 60);
    expect(Math.abs(cam.offsetXU) + Math.abs(cam.offsetYU)).toBeGreaterThan(0);
    expect(Math.abs(cam.rotationRad)).toBeLessThanOrEqual((SHAKE.maxRotationDeg / 180) * Math.PI);
    for (let i = 0; i < 200; i += 1) cam.update(1 / 60);
    expect(cam.trauma).toBe(0);
    expect(cam.offsetXU).toBe(0);
    cam.dispose();
  });

  it('연쇄 링크는 trauma를 chainCap 위로 올리지 않는다', () => {
    bus.reset();
    const cam = createCamera({ bus, rng: createRng(2) });
    bus.emit({ kind: 'parry', parrySeq: 1, grade: 'GOOD', count: 1, combo: 1, xU: 100, yU: 100 });
    for (let i = 0; i < 12; i += 1) {
      bus.emit({ kind: 'enemyKilled', parrySeq: 1, chainIndex: i, xU: 200, yU: 200 });
    }
    bus.flush();
    expect(cam.trauma).toBeLessThanOrEqual(TRAUMA_ON.chainCap + 1e-9);
    expect(cam.trauma).toBeGreaterThan(0.5);
    cam.dispose();
  });

  it('reduced-motion이면 변위가 0이다', () => {
    bus.reset();
    const cam = createCamera({ bus, rng: createRng(3) });
    cam.setReducedMotion(true);
    bus.emit({ kind: 'playerHit', cause: 'body', xU: 0, yU: 0, dirX: 1, dirY: 0 });
    bus.flush();
    cam.update(1 / 60);
    expect(cam.offsetXU).toBe(0);
    expect(cam.offsetYU).toBe(0);
    expect(cam.rotationRad).toBe(0);
    cam.dispose();
  });
});
