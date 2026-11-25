import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const rootDir = process.cwd();
const tempOutDir = path.join(rootDir, '.dist-wp-tmp');
const outFile = path.join(rootDir, 'wordpress', 'gatepass-full-app.html');
const pluginDir = path.join(rootDir, 'wordpress', 'gatepass-wp-plugin');
const pluginHtmlFile = path.join(pluginDir, 'app', 'gatepass-full-app.html');
const pluginZipFile = path.join(rootDir, 'wordpress', 'gatepass-loading-slip-manager.zip');
const apiBaseUrl = (process.env.WP_API_BASE_URL || process.env.APP_BASE_URL || 'https://loadingmanager.store').replace(/\/+$/, '');

// Standard CRC32 table for pure-Node PKZIP creation
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFilesRecursively(dirPath, basePrefix) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relName = `${basePrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath, relName));
    } else if (entry.isFile()) {
      results.push({ fullPath, zipName: relName });
    }
  }
  return results;
}

function createZipArchive(sourceDir, rootFolderName, destZipPath) {
  const files = collectFilesRecursively(sourceDir, rootFolderName);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.fullPath);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(file.zipName, 'utf8');
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // Compression method: deflate
    localHeader.writeUInt16LE(0, 10); // Mod time
    localHeader.writeUInt16LE(0x5421, 12); // Mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, compressed);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirBuf.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  const finalZip = Buffer.concat([...localParts, centralDirBuf, endRecord]);
  fs.writeFileSync(destZipPath, finalZip);
  return finalZip.length;
}

async function generateWordPressFullHtml() {
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  await build({
    root: rootDir,
    configFile: false,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    build: {
      outDir: tempOutDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: 100000000,
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
  });

  const indexHtmlPath = path.join(tempOutDir, 'index.html');
  let html = fs.readFileSync(indexHtmlPath, 'utf8');

  const assetsDir = path.join(tempOutDir, 'assets');
  const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

  const cssFiles = assetFiles.filter((f) => f.endsWith('.css'));
  const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));

  const combinedCss = cssFiles
    .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('\n')
    .replace(/<\/style/gi, '<\\/style');

  const combinedJs = jsFiles
    .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('\n')
    .replace(/<\/script/gi, '<\\/script');

  // Remove linked stylesheet & script tags generated by Vite
  html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>\s*/gi, '');
  html = html.replace(/<script[^>]*type=["']module["'][^>]*><\/script>\s*/gi, '');
  html = html.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>\s*/gi, '');

  const wpBootstrapScript = `<script>
    // Configure live API server or built-in WordPress AJAX/REST API (preserves all data)
    window.__GATEPASS_API_BASE__ = window.__GATEPASS_API_BASE__ || ${JSON.stringify(apiBaseUrl)};
    window.__GATEPASS_WP_AJAX_BASE__ = window.__GATEPASS_WP_AJAX_BASE__ || "";
    window.__GATEPASS_WP_REST_BASE__ = window.__GATEPASS_WP_REST_BASE__ || "";
  </script>`;

  // Inject CSS + API config right before </head> using callback to preserve literal $ characters
  html = html.replace(
    /<\/head>/i,
    () => `${wpBootstrapScript}\n<style id="gatepass-wp-styles">\n${combinedCss}\n</style>\n</head>`
  );

  // Inject single bundled module script before </body> using callback to preserve literal $ characters
  html = html.replace(
    /<\/body>/i,
    () => `<script type="module">\n${combinedJs}\n</script>\n</body>`
  );

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');

  // Copy latest HTML bundle into WordPress plugin directory and build uploadable ZIP
  fs.mkdirSync(path.dirname(pluginHtmlFile), { recursive: true });
  fs.writeFileSync(pluginHtmlFile, html, 'utf8');

  fs.rmSync(tempOutDir, { recursive: true, force: true });

  const zipBytes = createZipArchive(pluginDir, 'gatepass-loading-slip-manager', pluginZipFile);

  const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  const zipKb = (zipBytes / 1024).toFixed(1);
  console.log(`Generated full single-file WordPress HTML: ${outFile} (${sizeKb} KB)`);
  console.log(`Generated WordPress Plugin ZIP: ${pluginZipFile} (${zipKb} KB)`);
}

generateWordPressFullHtml().catch((err) => {
  console.error('Failed to build WordPress full HTML:', err);
  process.exit(1);
});
