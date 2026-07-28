# [AI Dev Strategy] 1주일 AI 에이전트 풀 가동 게임 개발 전략

---

## 1. 프레임워크 & 테크 스택 선정

### 추천 테크 스택: HTML5 Canvas + Pure JavaScript / Phaser.js / Three.js (또는 Godot WebGL)
1. **이유**:
   - **AI 코드 생성 성능 최고점**: LLM/Codex 계열 에이전트는 JS/Canvas/Phaser.js 코드 생성 정밀도가 Unity/C# 대비 월등히 높음 (단일 파일 혹은 모듈별 자동 합성이 매우 유연).
   - **빌드/실행 환경 무결점**: 설치 없이 브라우저에서 바로 구동 가능하여 심사위원 및 평가자가 즉시 플레이 가능 (오프라인 로컬 실행 완벽 지원).
   - **디버깅 속도**: 에러 발생 시 즉각 브라우저 콘솔에서 트레이스 가능.

---

## 2. AI 에이전트 분업 및 프롬프팅 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                 Main Orchestrator Agent                 │
└────────────────────────────┬────────────────────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
[Logic Agent]         [Render & VFX Agent]    [Audio/Level Agent]
- State Machine       - Canvas Shader/VFX     - Web Audio Synth
- Physics & Collision - Particle Engines      - Procedural Levels
- Game Loop           - UI / HUD              - Game Balance
```

### 필수 설계 패턴 (Design Patterns for AI Coding):
- **Component / ECS Pattern**: 에이전트가 코드를 모듈화하여 독립적으로 수정할 수 있도록 연관 관계 최소화.
- **State Machine Pattern**: 게임 상태(Menu, Playing, Rewind, Pause, GameOver)를 명확히 분리하여 에이전트 간 코드 충돌 방지.
- **Event Bus Pattern**: `EventBus.emit('PLAYER_HIT')` 방식으로 이벤트 처리.

---

## 3. 1주일(7일) 풀 스크린 개발 워크플로우

- **Day 1: MVP Core Loop**: 핵심 메커니즘 1개만 동작하는 최소 시범 프로토타입 작성 (도형 그래픽).
- **Day 2: Game Rules & Systems**: 승리/패배 조건, 스코어링, 인터랙티브 오브젝트 추가.
- **Day 3: Content Expansion**: 10~15개 스테이지, 보스 패턴 또는 다양한 기믹 추가.
- **Day 4: Juiciness & Polish**: 화면 흔들림(Screen Shake), 파티클 이펙트, 스무스 카메라, 모션 블러 추가 (AI로 100% 생성).
- **Day 5: Sound & UI**: Web Audio Synth 기반 SFX/BGM 및 네온 폰트 UI 결합.
- **Day 6: QA & Demo Recording**: 밸런스 튜닝 및 High-impact 1~3분 시연 영상 녹화.
- **Day 7: Documentation & Submission**: 사전 제출 서류 (게임 소개서 + AI 기술 문서) 작성 및 최종 검수.

---
*Generated for NHN Game x AI Hackathon (NAN 2026) Research.*
