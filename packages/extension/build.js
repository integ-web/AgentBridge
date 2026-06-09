const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const commonOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: true,
  outdir: 'dist',
  logLevel: 'info',
};

async function build() {
  // Copy static assets
  const staticDirs = ['sidepanel', 'ui', 'icons'];
  for (const dir of staticDirs) {
    const srcDir = path.join(__dirname, dir);
    const destDir = path.join(__dirname, 'dist', dir);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
    }
  }

  // Copy manifest
  fs.copyFileSync(
    path.join(__dirname, 'manifest.json'),
    path.join(__dirname, 'dist', 'manifest.json'),
  );

  // Build service worker
  const bgBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/background/service-worker.ts'],
    outdir: 'dist/background',
    format: 'esm',
  });

  // Build content scripts
  const contentBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/content/observer.ts'],
    outdir: 'dist/content',
    format: 'iife', // Content scripts must be IIFE
  });

  // Build side panel JS
  const panelBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ['src/sidepanel/app.ts'],
    outdir: 'dist/sidepanel',
    format: 'esm',
  });

  await Promise.all([bgBuild, contentBuild, panelBuild]);
  console.log('✅ Extension built successfully');
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
