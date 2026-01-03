const fs = require('fs');
const path = require('path');

const swaggerUiDist = require('swagger-ui-dist');

const srcDir = swaggerUiDist.getAbsoluteFSPath();
const outDir = path.join(process.cwd(), 'public', 'swagger');

fs.mkdirSync(outDir, { recursive: true });

for (const entry of fs.readdirSync(srcDir)) {
  const src = path.join(srcDir, entry);
  const dest = path.join(outDir, entry);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
}
