// Builds the browser-only ONLINE DEMO and writes one self-contained page (for publishing
// as a private web page). Usage: node scripts/build-online-demo.mjs <out.html>
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'online-demo.html';
execSync('npx vite build -c vite.demo.config.ts', { cwd: 'apps/web', stdio: 'inherit' });
const js = readFileSync('apps/web/dist-demo/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync('apps/web/dist-demo/app.css', 'utf8');
const page = `<title>Bite &amp; Brew Demo</title>
<meta name="description" content="Try the Bite &amp; Brew café system with sample data">
<style>
${css}
/* the published page provides its own document; keep the app's light theme and full height */
:root { color-scheme: light; }
html, body { height: 100%; background: #f7f0e3; }
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync(out, page);
console.log(`Online demo page written: ${out} (${(page.length / 1024).toFixed(0)} KB)`);
