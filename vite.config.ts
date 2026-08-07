/**
 * 개발은 dev server, 산출은 dist/index.html 한 장 (D-03 · 02 §9.2).
 *
 * 단일 파일로 접는 일은 vite-plugin-singlefile이 아니라 아래 generateBundle 훅이 한다.
 * 플러그인을 넣으면 의존성이 다섯 개가 되어 "vite·vitest·typescript·eslint 외 0개"가 깨진다.
 */

import { defineConfig, type Plugin } from 'vite';

/** 에셋 인라인 상한 (byte). 이 한도를 넘는 에셋은 별도 파일로 나가고 file://에서 fetch가 막힌다 */
const ASSET_INLINE_LIMIT_BYTES = 100 * 1024 * 1024;

/** 청크 이름에는 해시와 점이 들어간다. 정규식으로 쓰기 전에 메타 문자를 막는다 */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 태그를 찾지 못하면 던진다. 못 찾은 채로 청크만 지우면 빈 화면이 나오는데,
 * 빈 화면은 원인이 안 보이는 실패라 빌드가 성공한 것으로 오해된다.
 */
function replaceOnce(doc: string, tag: RegExp, inlined: string, chunkName: string): string {
  // 치환문을 함수로 넘긴다. 문자열로 넘기면 번들 코드 안의 `$&`·`$'`가 치환 지시로 해석된다
  const next = doc.replace(tag, () => inlined);
  if (next === doc) {
    throw new Error(`${chunkName}을 참조하는 태그가 index.html에 없다 — 단일 파일 빌드가 깨진다`);
  }
  return next;
}

function inlineSingleFile(): Plugin {
  return {
    name: 'hwando-single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      // order: 'post'가 있어야 한다. vite:build-import-analysis는 자기 generateBundle에서
      // 청크 코드의 __VITE_PRELOAD__ 자리표시자를 실제 의존 목록으로 바꾸는데, Vite가 그 내부
      // 플러그인을 사용자 enforce:'post' 플러그인보다 뒤에 세운다. 이 훅이 먼저 돌면 자리표시자가
      // 박힌 코드를 HTML에 옮기고 청크를 지워서, 바꿔야 할 대상이 사라진 채로 빌드가 성공한다.
      // 증상은 브라우저의 ReferenceError: __VITE_PRELOAD__ is not defined 하나뿐이다
      order: 'post',
      handler(_options, bundle) {
        const html = Object.values(bundle).find(
          (output) => output.type === 'asset' && output.fileName.endsWith('.html'),
        );
        if (html === undefined || html.type !== 'asset') {
          throw new Error('번들에 index.html이 없다');
        }
        let doc = String(html.source);
        for (const [name, output] of Object.entries(bundle)) {
          const at = escapeForRegExp(name);
          if (output.type === 'chunk') {
            const tag = new RegExp(`<script[^>]*src="[^"]*${at}"[^>]*>\\s*</script>`);
            doc = replaceOnce(doc, tag, `<script type="module">\n${output.code}</script>`, name);
          } else if (name.endsWith('.css')) {
            const tag = new RegExp(`<link[^>]*href="[^"]*${at}"[^>]*>`);
            doc = replaceOnce(doc, tag, `<style>\n${String(output.source)}</style>`, name);
          } else {
            continue;
          }
          delete bundle[name];
        }
        // 남은 modulepreload는 인라인된 뒤엔 가리킬 대상이 없고, file://에서 fetch 실패로 뜬다
        html.source = doc.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
      },
    },
  };
}

export default defineConfig({
  // file:// 더블클릭 실행이 산출 조건이다. 절대 경로가 남으면 드라이브 루트를 가리킨다
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: ASSET_INLINE_LIMIT_BYTES,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      // main.ts가 뒤 단계의 모듈을 동적으로 부른다. 코드 분할을 두면 그 청크가
      // 네트워크 요청이 되고, file://에서는 그것이 곧 실행 실패다
      output: { inlineDynamicImports: true },
    },
  },
  plugins: [inlineSingleFile()],
});
