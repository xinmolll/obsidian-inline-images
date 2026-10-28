import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'browser',
  format: 'cjs', target: 'es2020', outfile: 'main.js',
  external: ['obsidian', '@codemirror/state', '@codemirror/view', '@codemirror/language'],
  banner: { js: '/* 图片存进笔记 v1.6.0 | MIT License */' },
});
