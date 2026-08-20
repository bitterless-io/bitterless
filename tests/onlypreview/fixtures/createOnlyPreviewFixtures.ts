import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TINY_VP9_WEBM_BASE64 =
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAPkEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggPO7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAwV0GNTGF2ZjYyLjEyLjEwMESJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYjPusGh7msO05yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgkLCBELqBEJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMHNz2mPAi2PFiM+6waHuaw7TZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDAgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVCHeeBAKOggQAAgIJJg0IAAPAA9gA4JBwYjAAAMGAAABC///qN4ACjk4EAKACGAECSnABUAAADIAAAQkCjk4EAUACGAECSnABS4AADIAAAQkCjk4EAeACGAECSnABUAAADIAAAQkCjk4EAoACGAECSnABRgAADIAAAQkCjk4EAyACGAECSnABUAAADIAAAQkCjk4EA8ACGAECSnABS4AADIAAAQkCjk4EBGACGAECSnABUAAADIAAAQkCjk4EBQACGAECSnABPIAADIAAAQkCjk4EBaACGAECSnABUAAADIAAAQkCjk4EBkACGAMCSnABPIAADIAAAQkCjk4EBuACGAECSnABUAAADIAAAQkCjk4EB4ACGAECSnABRgAADIAAAQkCjk4ECCACGAECSnABUAAADIAAAQkCjk4ECMACGAECSnABS4AADIAAAQkCjk4ECWACGAECSnABUAAADIAAAQkCjk4ECgACGAECSnABPIAADIAAAQkCjk4ECqACGAECSnABUAAADIAAAQkCjk4EC0ACGAECSnABS4AADIAAAQkCjk4EC+ACGAECSnABUAAADIAAAQkCjk4EDIACGAMCSnABPIAADIAAAQkCjk4EDSACGAECSnABUAAADIAAAQkCjk4EDcACGAECSnABS4AADIAAAQkCjk4EDmACGAECSnABUAAADIAAAQkCjk4EDwACGAECSnABPIAADIAAAQkAcU7trkbuPs4EAt4r3gQHxggGr8IED';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const createPdf = (text: string): Buffer => {
  const content = `BT /F1 22 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'binary');
};

const createWav = (): Buffer => {
  const sampleRate = 8_000;
  const sampleCount = sampleRate * 2;
  const data = Buffer.alloc(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    data[index] = Math.round(128 + 48 * Math.sin((index / sampleRate) * Math.PI * 2 * 440));
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
};

export interface OnlyPreviewFixtureSet {
  root: string;
  text: string;
  textPath: string;
  pdfPath: string;
  imagePath: string;
  audioPath: string;
  videoPath: string;
  nestedTextPath: string;
  rawHtmlPath: string;
  rawHtmlStylePath: string;
  rawHtmlScriptPath: string;
  rawHtmlImagePath: string;
}

export interface OnlyPreviewSearchFixtureSet {
  selectedWatchPath: string;
  nonSelectedWatchPath: string;
}

export const createOnlyPreviewFixtures = (root: string): OnlyPreviewFixtureSet => {
  mkdirSync(root, { recursive: true });
  const text = 'OnlyPreview immutable Monaco fixture\nsecond selectable line\n';
  const textPath = join(root, 'copy.txt');
  const pdfPath = join(root, 'document.pdf');
  const imagePath = join(root, 'pixel.png');
  const audioPath = join(root, 'tone.wav');
  const videoPath = join(root, 'video.webm');
  const nestedTextPath = join(root, 'nested', 'inside.txt');
  const rawHtmlPath = join(root, 'nested', 'raw-page.html');
  const rawHtmlStylePath = join(root, 'nested', 'raw-page.css');
  const rawHtmlScriptPath = join(root, 'nested', 'raw-page.js');
  const rawHtmlImagePath = join(root, 'nested', 'raw-page.png');
  writeFileSync(textPath, text, 'utf8');
  writeFileSync(pdfPath, createPdf('OnlyPreview selectable PDF text'));
  writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  writeFileSync(audioPath, createWav());
  writeFileSync(videoPath, Buffer.from(TINY_VP9_WEBM_BASE64, 'base64'));
  mkdirSync(join(root, 'nested'), { recursive: true });
  writeFileSync(nestedTextPath, 'nested keyboard fixture\n', 'utf8');
  writeFileSync(
    rawHtmlPath,
    [
      '<!doctype html>',
      '<html><head>',
      '<meta charset="utf-8">',
      '<link rel="stylesheet" href="./raw-page.css">',
      '</head><body data-inline-script="pending" data-relative-script="pending">',
      '<h1 id="onlypreview-contained-style">OnlyPreview raw HTML fixture</h1>',
      '<img id="onlypreview-contained-image" src="./raw-page.png" alt="contained fixture">',
      '<script>document.body.dataset.inlineScript = "ready";</script>',
      '<script src="./raw-page.js"></script>',
      '</body></html>'
    ].join(''),
    'utf8'
  );
  writeFileSync(rawHtmlStylePath, '#onlypreview-contained-style { color: rgb(12, 34, 56); }\n');
  writeFileSync(rawHtmlScriptPath, 'document.body.dataset.relativeScript = "ready";\n', 'utf8');
  writeFileSync(rawHtmlImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  return {
    root,
    text,
    textPath,
    pdfPath,
    imagePath,
    audioPath,
    videoPath,
    nestedTextPath,
    rawHtmlPath,
    rawHtmlStylePath,
    rawHtmlScriptPath,
    rawHtmlImagePath
  };
};

export const createOnlyPreviewSearchFixtures = (root: string): OnlyPreviewSearchFixtureSet => {
  const writeText = (relativePath: string, content: string): string => {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return path;
  };

  mkdirSync(join(root, '.bitterless'), { recursive: true });
  writeFileSync(
    join(root, '.bitterless', 'preview-config.yml'),
    ['version: 1', 'exclude:', '  - generated/**', "  - '!generated/keep/**'", ''].join('\n'),
    'utf8'
  );

  writeText('nested/SearchNeedle-title.txt', 'filename-only fixture\n');
  writeText('nested/content.txt', '0123456789abcdefSearchNeedleabcdefghijklmnopqrstuvwx\n');
  writeText('nested/directory-scope.txt', 'scope-token in the selected directory\n');
  writeText('project-scope.txt', 'scope-token at the project root\n');
  writeText('nested/SearchNeedle-folder/neutral.txt', 'neutral directory child\n');
  writeText('nested/cjk.txt', '前缀文本中文关键字后缀文本\n');
  writeText('.root-hidden-match.txt', 'root hidden file title fixture\n');
  writeText('.hidden/inside-hidden.txt', 'exclusion-proof explicit-hidden-directory\n');
  writeText('allowed.txt', 'exclusion-proof visible-file\n');
  writeText('generated/drop/config-excluded.txt', 'exclusion-proof config-excluded\n');
  writeText('generated/keep/config-reincluded.txt', 'exclusion-proof config-reincluded\n');
  writeText('node_modules/pkg/hard-excluded.txt', 'exclusion-proof node-modules\n');
  writeText('dist/hard-excluded.txt', 'exclusion-proof dist\n');
  writeText('output/hard-excluded.txt', 'exclusion-proof output\n');

  return {
    selectedWatchPath: join(root, 'copy.txt'),
    nonSelectedWatchPath: join(root, 'nested', 'inside.txt')
  };
};
