/**
 * 진입 형태 6종 — 스펙 §8.2
 *
 * 웨이브는 "무엇이 나오는가"(stages/*의 squads)와 "어떻게 들어오는가"(이 표)를 따로 고른다.
 * 그래서 같은 편성이 F-3으로도 F-4로도 들어올 수 있고, §9.3~§9.7의 「F-3 + F-4」 표기가
 * 두 형태로 나눠 스폰하라는 뜻으로 성립한다.
 *
 * 여기 있는 것은 궤적의 파라미터뿐이고 궤적을 그리는 것은 sim/formations.ts다. §8.2는 여섯
 * 형태를 문장으로만 적어 두었으므로 숫자를 직접 준 자리가 F-4의 진폭 200u 하나뿐이다.
 * 나머지는 목업 실측이거나 이 파일이 정한 값이고, 어느 쪽인지는 값마다 주석에 적혀 있다 —
 * 스펙 개정과 튜닝을 구분하지 못하면 바꿔도 되는 값과 바꾸면 안 되는 값이 섞인다.
 *
 * stopYU는 §3.1의 적 활동 영역 y ∈ [-200, 1000] 안이어야 하고, 종대·횡대가 뒤로 늘어선
 * 만큼도 그 안이어야 한다 — F-1이라면 stopYU + spacingU × (기수 − 1)이 1000을 넘는 순간
 * 뒤쪽 개체가 활동 영역 밖에 선다. 타입이 못 잡는 관계라 편성을 늘릴 때 여기를 본다.
 *
 * spacingU가 무엇 사이의 간격인지는 형태마다 다르다 — 종대는 앞뒤, 횡대는 좌우, 측면 통과는
 * 레인 사이다. 한 이름이 세 축을 겸하므로 항목마다 어느 축인지 적었다.
 */
import type { FormationDef } from './types';
import type { FormationId } from './ids';

export const FORMATIONS = {
  'F-1': {
    name: '종대 강하',
    entrySide: 'top',
    spawnIntervalSec: 0.35,   // 스펙 값 없음. 뒤 개체가 이어 들어오는 간격 (s)
    spacingU: 120,            // 스펙 값 없음. 종대 앞뒤 간격 (u)
    stopYU: 300,              // §8.2 「지정 y에서 정지」의 y (u). 값 자체는 스펙에 없다
    amplitudeU: 0,            // §8.2 흔들지 않는다 (u)
    zigzagYU: 0,              // 한 줄로 선다 (u)
    note: '선두가 stopYU에 서고 뒤는 spacingU만큼씩 위에 남는다. 전원을 stopYU로 몰면 한 점에 겹친다',
  },
  'F-2': {
    name: '좌우 협공',
    entrySide: 'bothSides',
    spawnIntervalSec: 0.45,   // 스펙 값 없음. 같은 쪽의 다음 개체까지 (s). 좌우는 §8.2대로 동시다
    spacingU: 150,            // 스펙 값 없음. 같은 쪽 개체 사이의 세로 간격 (u)
    stopYU: 420,              // 스펙 값 없음. 안쪽으로 들어와 멈추는 y (u)
    amplitudeU: 0,            // §8.2 흔들지 않는다 (u)
    zigzagYU: 0,              // 한 줄로 선다 (u)
    note: '안쪽 정지 x는 이 표에 없다 — FormationDef에 가로 좌표 필드가 없어서다. 좌우 대칭이므로 sim/formations.ts가 기수와 spacingU로 정한다',
  },
  'F-3': {
    name: '횡대 정렬',
    entrySide: 'top',
    spawnIntervalSec: 0.12,   // 스펙 값 없음. 좌우로 펼쳐지는 순서 간격 (s). 0이면 F-5와 구분이 사라진다
    spacingU: 170,            // 스펙 값 없음. 정렬 후 좌우 등간격 (u). 6기까지 가로 1080u 안에 선다
    stopYU: 240,              // 스펙 값 없음. 정렬선 y (u)
    amplitudeU: 0,            // §8.2 흔들지 않는다 (u)
    zigzagYU: 0,              // 한 줄로 선다 (u)
    note: '§9.3~§9.7이 F-4와 짝지어 쓴다. 위에서 횡대가 고정 사격을 하고 그 아래로 사인 강하가 파고드는 배치다',
  },
  'F-4': {
    name: '사인 곡선 강하',
    entrySide: 'top',
    spawnIntervalSec: 0.40,   // 스펙 값 없음. 뒤 개체가 이어 들어오는 간격 (s)
    spacingU: 130,            // 스펙 값 없음. 앞뒤 간격 (u)
    stopYU: 520,              // 스펙 값 없음. 흔들며 내려와 멈추는 y (u). F-3보다 아래다
    amplitudeU: 200,          // §8.2가 직접 준 유일한 값 — 좌우 진폭 (u)
    zigzagYU: 0,              // 한 줄로 선다 (u). 흔드는 것은 amplitudeU다
    note: '진폭 200u는 중심 경로가 x ∈ [200, 880] 안에 있어야 화면 밖으로 나가지 않는다는 뜻이기도 하다',
  },
  'F-5': {
    name: '성벽 배치',
    entrySide: 'top',
    spawnIntervalSec: 0,      // §8.2 즉시 배치. 진입 이동 자체가 없다 (s)
    spacingU: 170,            // 목업 03_stage2_dongnaeseong/scene.js의 x 간격 실측 (u)
    stopYU: 240,              // 목업 03_stage2_dongnaeseong/scene.js의 배치 y 실측 (u)
    amplitudeU: 0,            // §8.2 이동 없음 (u)
    zigzagYU: 46,             // 목업 03_stage2_dongnaeseong/scene.js:11의 `240 + (i % 2) * 46` 실측 (u)
    note: '성곽·함선 스테이지 전용. 한 칸 걸러 내려 세우는 것이 성벽의 총안처럼 읽히게 하는 유일한 장치다',
  },
  'F-6': {
    name: '측면 통과',
    entrySide: 'bothSides',
    spawnIntervalSec: 0.70,   // 목업 09_stage5_noryang/scene.js의 진입 간격 실측 (s)
    spacingU: 90,             // 목업 09_stage5_noryang/scene.js의 레인 사이 세로 간격 실측 (u)
    stopYU: null,             // §8.2 정지하지 않는다. 통과 후 소멸이고 되돌아오지 않는다(A8)
    amplitudeU: 0,            // §8.2 흔들지 않는다 (u)
    zigzagYU: 0,              // 레인이 이미 spacingU만큼 갈려 있다 (u)
    note: '개체 하나는 한쪽에서만 들어오고 좌우를 번갈아 낸다. 첫 레인의 y는 이 표에 없다 — stopYU가 null이라 담을 자리가 없고, sim/formations.ts가 플레이어 영역 상단부터 spacingU만큼씩 내려 잡는다',
  },
} as const satisfies Record<FormationId, FormationDef>;
