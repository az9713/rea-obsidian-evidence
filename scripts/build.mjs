import * as esbuild from 'esbuild';
await esbuild.build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true, platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian'], sourcemap: false, banner: { js: '/* Evidence Anchor 0.1.0 · MIT · Public Obsidian API extension */' } });
await esbuild.build({ entryPoints: ['src/demo.ts'], outfile: 'docs/demo.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
console.log('Built installable main.js.');
