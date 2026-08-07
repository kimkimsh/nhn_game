/**
 * `npm run balance`의 진입점. 표를 stdout에 찍고 판정을 종료 코드로 낸다.
 *
 * 집계와 판정은 전부 `dev/balance.ts`에 있고 여기는 그것을 프로세스 경계에 붙이기만 한다 —
 * 종료 코드와 stdout이 유일한 부수효과라야 리포트 자체를 테스트에서 부를 수 있다.
 *
 * vite-node로 도는 것은 `sim/guards.ts`의 `GUARDS_ENABLED`가 `import.meta.env.DEV`라서다.
 * 맨 node에서는 그 값을 읽을 수 없어 가드가 통째로 꺼진 채 도는데, **가드가 꺼진 리포트는
 * 09 §2.1이 잡으라고 한 규칙 위반을 한 건도 못 본다.**
 */
import { BALANCE_SEEDS, formatBalanceReport, hasFailure, runBalanceSuite, toJson } from './balance';

const suite = runBalanceSuite(BALANCE_SEEDS);
if (process.argv.includes('--json')) {
  process.stdout.write(`${toJson(suite)}\n`);
} else {
  process.stdout.write(`${formatBalanceReport(suite)}\n`);
}
process.exitCode = hasFailure(suite) ? 1 : 0;
