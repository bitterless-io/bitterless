/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-ooxml-'));
const bundlePath = join(buildRoot, 'ooxml-preflight.mjs');

await build({
  stdin: {
    contents: `
      export * from './src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service';
      export {
        ONLY_PREVIEW_SHEET_MAX_CELLS,
        ONLY_PREVIEW_SHEET_MAX_MERGES
      } from './src/renderer/onlypreview/preview/src/workers/onlyPreviewSheetWorker.contract';
    `,
    loader: 'ts',
    resolveDir: projectRoot,
    sourcefile: 'onlyPreviewOoxmlPreflight.test-entry.ts'
  },
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const UTF8_FLAG = 0x0800;
const CRC32_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const toArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const createExtraField = (id, body = Buffer.alloc(0)) => {
  const field = Buffer.alloc(4 + body.length);
  field.writeUInt16LE(id, 0);
  field.writeUInt16LE(body.length, 2);
  body.copy(field, 4);
  return field;
};

const buildZip = (entries, options = {}) => {
  const prefix = options.prefix ?? Buffer.alloc(0);
  const localParts = [prefix];
  const records = [];
  let localCursor = prefix.length;

  for (const entry of entries) {
    const rawName = entry.rawName ?? Buffer.from(entry.name, 'utf8');
    const flags = entry.flags ?? UTF8_FLAG;
    const method = entry.method ?? 0;
    const uncompressedData =
      entry.uncompressedData ?? (method === 0 ? (entry.data ?? Buffer.alloc(0)) : null);
    const generatedData =
      method === 8 && uncompressedData ? deflateRawSync(uncompressedData) : Buffer.alloc(0);
    const data =
      entry.data ??
      (method === 8 && uncompressedData ? generatedData : Buffer.alloc(entry.compressedSize ?? 0));
    const compressedSize = entry.compressedSize ?? data.length;
    const uncompressedSize = entry.uncompressedSize ?? uncompressedData?.length ?? compressedSize;
    assert.equal(data.length, compressedSize, `fixture data length for ${entry.name}`);
    const checksum = entry.crc32 ?? crc32(uncompressedData ?? Buffer.alloc(0));
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const localRawName = entry.localRawName ?? rawName;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(entry.localFlags ?? flags, 6);
    localHeader.writeUInt16LE(entry.localMethod ?? method, 8);
    localHeader.writeUInt32LE(entry.localCrc32 ?? checksum, 14);
    localHeader.writeUInt32LE(entry.localCompressedSize ?? compressedSize, 18);
    localHeader.writeUInt32LE(entry.localUncompressedSize ?? uncompressedSize, 22);
    localHeader.writeUInt16LE(localRawName.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);

    const localOffset = localCursor;
    const gapAfter = entry.gapAfter ?? Buffer.alloc(0);
    localParts.push(localHeader, localRawName, localExtra, data, gapAfter);
    localCursor += localHeader.length + localRawName.length + localExtra.length + data.length;
    localCursor += gapAfter.length;
    records.push({
      entry,
      rawName,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      crc32: checksum,
      localOffset
    });
  }

  const centralOffset = localCursor;
  const centralParts = [];
  const centralRecordOffsets = [];
  let centralCursor = centralOffset;
  for (const record of records) {
    const { entry } = record;
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const comment = entry.comment ?? Buffer.alloc(0);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(entry.versionMadeBy ?? 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(entry.centralFlags ?? record.flags, 8);
    centralHeader.writeUInt16LE(entry.centralMethod ?? record.method, 10);
    centralHeader.writeUInt32LE(entry.centralCrc32 ?? record.crc32, 16);
    centralHeader.writeUInt32LE(entry.centralCompressedSize ?? record.compressedSize, 20);
    centralHeader.writeUInt32LE(entry.centralUncompressedSize ?? record.uncompressedSize, 24);
    centralHeader.writeUInt16LE(record.rawName.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt16LE(comment.length, 32);
    centralHeader.writeUInt16LE(entry.diskNumber ?? 0, 34);
    centralHeader.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    centralHeader.writeUInt32LE(entry.centralLocalOffset ?? record.localOffset, 42);
    centralRecordOffsets.push(centralCursor);
    centralParts.push(centralHeader, record.rawName, centralExtra, comment);
    centralCursor +=
      centralHeader.length + record.rawName.length + centralExtra.length + comment.length;
  }

  const centralSize = centralCursor - centralOffset;
  const archiveComment = options.comment ?? Buffer.alloc(0);
  const eocdOffset = centralCursor;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(options.centralDiskNumber ?? 0, 6);
  eocd.writeUInt16LE(options.diskEntryCount ?? entries.length, 8);
  eocd.writeUInt16LE(options.entryCount ?? entries.length, 10);
  eocd.writeUInt32LE(options.centralSize ?? centralSize, 12);
  eocd.writeUInt32LE(options.centralOffset ?? centralOffset, 16);
  eocd.writeUInt16LE(archiveComment.length, 20);

  return {
    buffer: Buffer.concat([...localParts, ...centralParts, eocd, archiveComment]),
    centralOffset,
    centralRecordOffsets,
    eocdOffset,
    records
  };
};

const xlsxEntries = (extra = []) => [
  { name: '[Content_Types].xml' },
  { name: '_rels/.rels' },
  { name: 'xl/workbook.xml' },
  ...extra
];

const docxEntries = (extra = []) => [
  { name: '[Content_Types].xml' },
  { name: '_rels/.rels' },
  { name: 'word/document.xml' },
  ...extra
];

const worksheetEntry = (data, options = {}) => ({
  name: 'xl/worksheets/sheet1.xml',
  data,
  ...options
});

const worksheetXml = (mergeTags) =>
  Buffer.from(`<worksheet><mergeCells>${mergeTags}</mergeCells></worksheet>`);

const preflight = (fixture, kind = 'xlsx', options) => {
  const archive = Buffer.isBuffer(fixture) ? fixture : fixture.buffer;
  return runtime.preflightOnlyPreviewOoxml(toArrayBuffer(archive), kind, options);
};

const expectCode = async (fixture, code, kind = 'xlsx', options) => {
  await assert.rejects(
    () => preflight(fixture, kind, options),
    (error) => error instanceof runtime.OnlyPreviewOoxmlPreflightError && error.code === code
  );
};

test('accepts exact STORE/DEFLATE XLSX and DOCX archives plus empty directories', async () => {
  const sheetData = Buffer.from('OnlyPreview sheet payload');
  const xlsx = buildZip(
    xlsxEntries([
      { name: 'xl/', method: 0 },
      { name: 'xl/worksheets/', method: 0 },
      {
        name: 'cp437-placeholder',
        rawName: Buffer.concat([
          Buffer.from('xl/cp437-'),
          Buffer.from([0xc3, 0xa9]),
          Buffer.from('.xml')
        ]),
        flags: 0
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        method: 8,
        uncompressedData: sheetData
      }
    ])
  );
  const xlsxResult = await preflight(xlsx);
  assert.equal(xlsxResult.kind, 'xlsx');
  assert.equal(xlsxResult.entries.length, 7);
  assert.equal(
    xlsxResult.entries.some((entry) => entry.name === 'xl/cp437-├⌐.xml'),
    true
  );
  assert.equal(xlsxResult.totalUncompressedBytes, sheetData.length);

  const docx = buildZip(
    docxEntries([
      {
        name: 'word/document2.xml',
        method: 8,
        uncompressedData: Buffer.from('document')
      }
    ])
  );
  assert.equal((await preflight(docx, 'docx')).entries.length, 4);
});

test('accepts the directory and ZIP structure emitted by the installed ExcelJS engine', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet 1');
  sheet.getCell('A1').value = 'OnlyPreview';
  const generated = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await preflight(generated);
  assert.equal(result.kind, 'xlsx');
  assert.equal(
    result.entries.some((entry) => entry.name === 'xl/workbook.xml'),
    true
  );
  assert.equal(
    result.entries.some((entry) => entry.name.endsWith('/')),
    true
  );
});

test('requires the exact package parts for each OOXML kind', async () => {
  await expectCode(
    buildZip([
      { name: '[Content_Types].xml' },
      { name: '_rels/.rels' },
      { name: 'word/document.xml' }
    ]),
    'OOXML_ARCHIVE_INVALID',
    'xlsx'
  );
  await expectCode(
    buildZip([
      { name: '[Content_Types].xml' },
      { name: '_rels/.rels' },
      { name: 'xl/workbook.xml' }
    ]),
    'OOXML_ARCHIVE_INVALID',
    'docx'
  );
});

test('rejects missing, trailing, and ambiguous EOCD records and central-directory disagreement', async () => {
  const valid = buildZip(xlsxEntries());
  await expectCode(Buffer.concat([valid.buffer, Buffer.from([0])]), 'OOXML_ARCHIVE_INVALID');

  const ambiguousComment = Buffer.alloc(22);
  ambiguousComment.writeUInt32LE(0x06054b50, 0);
  ambiguousComment.writeUInt16LE(0, 20);
  await expectCode(buildZip(xlsxEntries(), { comment: ambiguousComment }), 'OOXML_ARCHIVE_INVALID');

  const wrongCentralSize = Buffer.from(valid.buffer);
  wrongCentralSize.writeUInt32LE(
    wrongCentralSize.readUInt32LE(valid.eocdOffset + 12) + 1,
    valid.eocdOffset + 12
  );
  await expectCode(wrongCentralSize, 'OOXML_ARCHIVE_INVALID');

  const missingSignature = Buffer.from(valid.buffer);
  missingSignature.writeUInt32LE(0, valid.eocdOffset);
  await expectCode(missingSignature, 'OOXML_ARCHIVE_INVALID');
});

test('rejects multi-disk, Zip64, data-descriptor, unsupported-method, and encrypted structures', async () => {
  await expectCode(buildZip(xlsxEntries(), { diskNumber: 1 }), 'OOXML_ARCHIVE_INVALID');
  await expectCode(buildZip(xlsxEntries(), { entryCount: 0xffff }), 'OOXML_ARCHIVE_INVALID');
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/descriptor.bin', flags: UTF8_FLAG | 0x0008 }])),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/bzip.bin', method: 12 }])),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/secret.bin', flags: UTF8_FLAG | 0x0001 }])),
    'OOXML_ENCRYPTED'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/aes.bin',
          centralExtra: createExtraField(0x9901),
          localExtra: createExtraField(0x9901)
        }
      ])
    ),
    'OOXML_ENCRYPTED'
  );
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/aes-method.bin', method: 99 }])),
    'OOXML_ENCRYPTED'
  );
});

test('rejects unsafe or ambiguous decoded entry names before an engine sees them', async () => {
  const invalidNames = [
    '../evil.xml',
    '/absolute.xml',
    'C:/drive.xml',
    'xl\\backslash.xml',
    'xl//empty.xml',
    'xl/./dot.xml',
    'xl/../traversal.xml',
    'xl/control\u0000.xml',
    'xl/control\u0085.xml'
  ];
  for (const name of invalidNames) {
    await expectCode(buildZip(xlsxEntries([{ name }])), 'OOXML_ARCHIVE_INVALID');
  }

  await expectCode(buildZip(xlsxEntries([{ name: 'xl/workbook.xml' }])), 'OOXML_ARCHIVE_INVALID');
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl' }, { name: 'xl/' }])),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'invalid-utf8',
          rawName: Buffer.from([0xc3, 0x28]),
          flags: UTF8_FLAG
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'cp437-alias',
          rawName: Buffer.concat([
            Buffer.from('xl/alias-'),
            Buffer.from([0xc3, 0xa9]),
            Buffer.from('.xml')
          ]),
          flags: 0
        },
        { name: 'xl/alias-é.xml' }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/override.xml',
          centralExtra: createExtraField(0x7075),
          localExtra: createExtraField(0x7075)
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'cp437-placeholder',
          rawName: Buffer.concat([
            Buffer.from('xl/cp437-'),
            Buffer.from([0x80]),
            Buffer.from('.xml')
          ]),
          flags: 0
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/café.xml' }, { name: 'xl/café.xml' }])),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/attribute-directory', externalAttributes: 0x10 }])),
    'OOXML_ARCHIVE_INVALID'
  );
});

test('requires empty STORE directory entries', async () => {
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/not-empty/', data: Buffer.from('x') }])),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/deflated/', method: 8 }])),
    'OOXML_ARCHIVE_INVALID'
  );
});

test('requires local records to close contiguously and agree exactly with central records', async () => {
  await expectCode(
    buildZip(
      xlsxEntries([
        { name: 'xl/gapped.xml', gapAfter: Buffer.from([0xaa]) },
        { name: 'xl/after-gap.xml' }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );

  const crcMismatch = buildZip(xlsxEntries());
  const crcBytes = Buffer.from(crcMismatch.buffer);
  crcBytes.writeUInt32LE(1, crcMismatch.records[0].localOffset + 14);
  await expectCode(crcBytes, 'OOXML_ARCHIVE_INVALID');

  const nameMismatch = buildZip(
    xlsxEntries([
      { name: 'xl/central-name.xml', localRawName: Buffer.from('xl/local-name-xx.xml') }
    ])
  );
  await expectCode(nameMismatch, 'OOXML_ARCHIVE_INVALID');

  const overlapBase = buildZip(xlsxEntries());
  const overlapBytes = Buffer.from(overlapBase.buffer);
  overlapBytes.writeUInt32LE(
    overlapBase.records[0].localOffset,
    overlapBase.centralRecordOffsets[1] + 42
  );
  await expectCode(overlapBytes, 'OOXML_ARCHIVE_INVALID');

  await expectCode(buildZip(xlsxEntries(), { prefix: Buffer.from([0]) }), 'OOXML_ARCHIVE_INVALID');
});

test('streams and verifies actual STORE/DEFLATE sizes and CRC before parser admission', async () => {
  await expectCode(
    buildZip(xlsxEntries([{ name: 'xl/store-crc.bin', data: Buffer.from('store'), crc32: 1 }])),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/deflate-crc.bin',
          method: 8,
          uncompressedData: Buffer.from('deflated payload'),
          crc32: 1
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/lying-size.bin',
          method: 8,
          uncompressedData: Buffer.alloc(100_000),
          uncompressedSize: 100
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/corrupt-deflate.bin',
          method: 8,
          data: Buffer.from([0xff, 0xff, 0xff]),
          uncompressedSize: 1
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
});

test('rejects worksheet merge expansion before ExcelJS can materialize merged child cells', async () => {
  const oversizedWorksheet = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><worksheet><mergeCells count="1"><mergeCell ref="A1:SH100000"/></mergeCells></worksheet>'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/worksheets/sheet1.xml',
          method: 8,
          uncompressedData: oversizedWorksheet
        }
      ])
    ),
    'OOXML_ARCHIVE_LIMIT'
  );
});

test('streams namespace-prefixed merge tags across 64KiB and ignores comment or CDATA decoys', async () => {
  const namespacePrefix = `p${'n'.repeat(512)}`;
  const bomAndOpening = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<worksheet>')
  ]);
  const padding = Buffer.alloc(64 * 1024 - bomAndOpening.byteLength - 1, 0x20);
  const xml = Buffer.concat([
    bomAndOpening,
    padding,
    Buffer.from(
      `<${namespacePrefix}:mergeCell xmlns:${namespacePrefix}="urn:onlypreview" ref = 'A1:B2' />` +
        '<!-- <mergeCell ref="A1:XFD1048576"/> -->' +
        '<![CDATA[<mergeCell ref="A1:XFD1048576"/>]]>' +
        '<mergeCell ref="C1:D2"></mergeCell>' +
        '</worksheet>'
    )
  ]);
  await preflight(buildZip(xlsxEntries([worksheetEntry(xml)])));
});

test('enforces exact aggregate merged-cell expansion and rejects the first cell beyond it', async () => {
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_MERGED_CELLS, runtime.ONLY_PREVIEW_SHEET_MAX_CELLS);
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_MERGED_CELLS, 500_000);
  const firstHalf = worksheetEntry(worksheetXml('<mergeCell ref="A1:A250000"/>'));
  const exactSecondHalf = {
    name: 'xl/custom/merge-data.xml',
    data: worksheetXml('<mergeCell ref="A1:A250000"/>')
  };
  await preflight(buildZip(xlsxEntries([firstHalf, exactSecondHalf])));

  const oneTooMany = {
    ...exactSecondHalf,
    data: worksheetXml('<mergeCell ref="A1:A250001"/>')
  };
  await expectCode(buildZip(xlsxEntries([firstHalf, oneTooMany])), 'OOXML_ARCHIVE_LIMIT');
});

test('enforces exact merge-range record count and rejects record 100001', async () => {
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES, runtime.ONLY_PREVIEW_SHEET_MAX_MERGES);
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES, 100_000);
  const record = '<mergeCell ref="A1:B1"/>';
  const exactRecords = record.repeat(runtime.ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES);
  await preflight(buildZip(xlsxEntries([worksheetEntry(worksheetXml(exactRecords))])));

  await expectCode(
    buildZip(xlsxEntries([worksheetEntry(worksheetXml(`${exactRecords}${record}`))])),
    'OOXML_ARCHIVE_LIMIT'
  );
});

test('rejects malformed, ambiguous, entity-based, or missing merge references', async () => {
  const malformedTags = [
    '<mergeCell/>',
    '<mergeCell ref="A1:B2" ref="C1:D2"/>',
    '<mergeCell ref="A1&#58;B2"/>',
    '<mergeCell ref=A1:B2/>',
    '<mergeCell ref="A1:B2/>',
    '<mergeCell ref="A1"/>',
    '<mergeCell ref="A1:A1"/>',
    '<m:mergeCell m:ref="A1:B2"/>',
    '<m:n:mergeCell ref="A1:B2"/>',
    '<m:mergeCell ref="A1:B2"></n:mergeCell>'
  ];
  for (const tag of malformedTags) {
    await expectCode(
      buildZip(xlsxEntries([worksheetEntry(worksheetXml(tag))])),
      'OOXML_ARCHIVE_INVALID'
    );
  }

  const oversizedPrefix = `p${'n'.repeat(runtime.ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES)}`;
  await expectCode(
    buildZip(
      xlsxEntries([worksheetEntry(worksheetXml(`<${oversizedPrefix}:mergeCell ref="A1:B2"/>`))])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
});

test('requires strict UTF-8 XLSX XML without UTF-16 BOM or NUL bytes', async () => {
  const invalidXmlPayloads = [
    Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x2f, 0x00, 0x3e, 0x00]),
    Buffer.from('<worksheet>\u0000</worksheet>'),
    Buffer.from([0x3c, 0x77, 0x3e, 0xc3, 0x28, 0x3c, 0x2f, 0x77, 0x3e])
  ];
  for (const payload of invalidXmlPayloads) {
    await expectCode(buildZip(xlsxEntries([worksheetEntry(payload)])), 'OOXML_ARCHIVE_INVALID');
  }
});

test('checks the monotonic ten-second preflight deadline inside structure loops', async () => {
  let tick = -5_000;
  await expectCode(buildZip(xlsxEntries()), 'OOXML_PREFLIGHT_TIMEOUT', 'xlsx', {
    now: () => {
      tick += 5_000;
      return tick;
    }
  });

  const deflated = buildZip(
    xlsxEntries([{ name: 'xl/late-read.bin', method: 8, uncompressedData: Buffer.from('late') }])
  );
  let successfulChecks = 0;
  await preflight(deflated, 'xlsx', {
    now: () => {
      successfulChecks += 1;
      return 0;
    }
  });
  let currentCheck = 0;
  await expectCode(deflated, 'OOXML_PREFLIGHT_TIMEOUT', 'xlsx', {
    now: () => {
      currentCheck += 1;
      return currentCheck === successfulChecks ? 10_000 : 0;
    }
  });
});

test('enforces input, entry-count, expansion, and compression-ratio limits', async () => {
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_ARCHIVE_BYTES, 25 * 1024 * 1024);
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES, 128 * 1024 * 1024);
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES, 200 * 1024 * 1024);
  assert.equal(runtime.ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO, 200);
  await expectCode(
    Buffer.alloc(runtime.ONLY_PREVIEW_OOXML_MAX_ARCHIVE_BYTES + 1),
    'OOXML_ARCHIVE_LIMIT'
  );

  const exactCountEntries = xlsxEntries(
    Array.from({ length: runtime.ONLY_PREVIEW_OOXML_MAX_ENTRIES - 3 }, (_, index) => ({
      name: `xl/empty-${index}.xml`
    }))
  );
  assert.equal((await preflight(buildZip(exactCountEntries))).entries.length, 5_000);
  await expectCode(
    buildZip([...exactCountEntries, { name: 'xl/one-too-many.xml' }]),
    'OOXML_ARCHIVE_LIMIT'
  );

  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/too-large.bin',
          method: 8,
          compressedSize: 700_000,
          uncompressedSize: runtime.ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES + 1
        }
      ])
    ),
    'OOXML_ARCHIVE_LIMIT'
  );

  await expectCode(
    buildZip([
      {
        name: '[Content_Types].xml',
        method: 8,
        compressedSize: 524_288,
        uncompressedSize: 100 * 1024 * 1024
      },
      {
        name: '_rels/.rels',
        method: 8,
        compressedSize: 524_289,
        uncompressedSize: 100 * 1024 * 1024 + 1
      },
      { name: 'xl/workbook.xml' }
    ]),
    'OOXML_ARCHIVE_LIMIT'
  );

  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/ratio-limit.bin',
          method: 8,
          compressedSize: 1,
          uncompressedSize: runtime.ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO + 1
        }
      ])
    ),
    'OOXML_ARCHIVE_LIMIT'
  );
});

test('rejects malformed extra-field closure and Zip64 fields in local or central records', async () => {
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/malformed-extra.bin',
          centralExtra: Buffer.from([1, 0, 4, 0, 0])
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  await expectCode(
    buildZip(
      xlsxEntries([
        {
          name: 'xl/zip64.bin',
          centralExtra: createExtraField(0x0001),
          localExtra: createExtraField(0x0001)
        }
      ])
    ),
    'OOXML_ARCHIVE_INVALID'
  );
});
