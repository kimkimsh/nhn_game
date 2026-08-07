/**
 * 계층 의존 규칙을 빌드 에러로 만든다 — 03_파일_구조.md §5의 표가 원본이다.
 *
 * 이 파일이 P0에 있는 이유는, 나중에 넣으면 이미 위반한 코드가 쌓여 있기 때문이다(11 §2).
 * 규칙이 잡는 것은 「어느 폴더가 어느 폴더를 import 하는가」 하나뿐이다. 어느 함수가
 * 공개인지 같은 것은 경로로 표현되지 않으므로 여기서 잡지 않는다.
 */

import tseslint from 'typescript-eslint';

/**
 * gitignore 형식 패턴은 세그먼트 단위로 맞춘다. `**\/x`는 폴더 자체를,
 * `**\/x/**`는 그 아래를 가리키므로 둘 다 적어야 `../x`와 `../x/y`가 함께 걸린다.
 */
function anywhereUnder(folder) {
  return [`**/${folder}`, `**/${folder}/**`];
}

function forbid(folders, message) {
  return { group: folders.flatMap(anywhereUnder), message };
}

/** 폴더 밖으로 나가는 상대 경로. `../**`는 `../x`와 `../x/y`를 모두 덮는다 */
const ESCAPES_ONE_LEVEL = ['../*', '../**'];
const ESCAPES_TWO_LEVELS = ['../../*', '../../**'];

function restrictedImports(patterns) {
  return { 'no-restricted-imports': ['error', { patterns }] };
}

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'docs/**', 'node_modules/**', '.remember/**', 'probe.html'],
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },

  {
    // config/ 는 숫자와 표뿐이다. 폴더 밖을 참조하는 순간 로직이 따라 들어온다
    files: ['src/config/*.ts'],
    rules: restrictedImports([
      {
        group: ESCAPES_ONE_LEVEL,
        message: 'config/는 src/config 밖을 import하지 않는다 (03 §5). 계산이 필요하면 sim/이 갖는다',
      },
    ]),
  },
  {
    files: ['src/config/*/*.ts'],
    rules: restrictedImports([
      {
        group: ESCAPES_TWO_LEVELS,
        message: 'config/는 src/config 밖을 import하지 않는다 (03 §5)',
      },
    ]),
  },

  {
    // core/ 는 게임 규칙을 모르는 범용 부품이다. 폴더 밖을 알면 범용이 아니다
    files: ['src/core/*.ts'],
    rules: restrictedImports([
      {
        group: ESCAPES_ONE_LEVEL,
        message: 'core/는 완전 독립이다 (03 §5). src/core 밖을 import하지 않는다',
      },
    ]),
  },

  {
    // sim/ 은 config·core만 본다. render를 보면 프레임률이 판정에 섞인다 (HR-06)
    files: ['src/sim/*.ts'],
    rules: {
      ...restrictedImports([
        forbid(
          ['render', 'audio', 'screens', 'dev', 'boot'],
          'sim/은 config/와 core/만 import한다 (03 §5). 연출이 필요하면 피드백 이벤트로 내보낸다 (02 §6)',
        ),
      ]),
      // 표의 "절대 안 되는 것" 칸에 document·window·canvas가 있다. import가 아니라 전역이라 따로 막는다
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'sim/은 canvas·document·window를 모른다 (03 §5)' },
        { name: 'document', message: 'sim/은 canvas·document·window를 모른다 (03 §5)' },
        { name: 'navigator', message: 'sim/은 canvas·document·window를 모른다 (03 §5)' },
        { name: 'localStorage', message: 'sim/은 canvas·document·window를 모른다 (03 §5)' },
        { name: 'sessionStorage', message: 'sim/은 canvas·document·window를 모른다 (03 §5)' },
        {
          name: 'requestAnimationFrame',
          message: 'sim/은 고정 스텝으로 돈다 (D-04). 프레임에 걸리면 판정이 프레임률을 탄다',
        },
        {
          name: 'performance',
          message: 'sim/의 시각은 인자로 받은 누적 sim 시간이다 (D-05). 벽시계를 읽으면 결정론이 깨진다',
        },
      ],
    },
  },

  {
    // render/ 는 sim의 타입만 읽는다. 상태를 한 줄이라도 바꾸면 프레임률이 판정에 영향을 준다
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              ...forbid(
                ['sim'],
                'render/는 sim/의 타입만 읽는다 (03 §5). `import type`으로 적고, 값이 필요하면 screens/가 인자로 넘긴다',
              ),
              allowTypeImports: true,
            },
            forbid(
              ['audio', 'screens', 'dev', 'boot'],
              'render/가 import해도 되는 것은 config·core·sim의 타입뿐이다 (03 §5). ctx와 축척은 screens/가 인자로 넘긴다',
            ),
          ],
        },
      ],
    },
  },

  {
    files: ['src/audio/*.ts'],
    rules: restrictedImports([
      forbid(
        ['sim', 'render', 'screens', 'dev', 'boot'],
        'audio/는 config/와 core/만 import한다 (03 §5). 소리는 sim이 발행한 이벤트를 받아 낸다',
      ),
    ]),
  },

  {
    // dev/ 는 sim의 공개 조작 함수를 부른다. 부를 수 있는 것이 공개 함수뿐이라는 것은
    // 경로로 표현되지 않으므로 여기서 막는 것은 나머지 계층뿐이다 (03 §2.4)
    files: ['src/dev/*.ts'],
    rules: restrictedImports([
      forbid(
        ['render', 'audio', 'screens', 'boot'],
        'dev/는 config·core와 sim/의 공개 조작 함수만 부른다 (03 §5 · §2.4)',
      ),
    ]),
  },
);
