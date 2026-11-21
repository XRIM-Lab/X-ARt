import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  'index.html',
  'TTY2/index.html',
  'EFV/index.html',
  'NMM/index.html',
  'CSLT/index.html'
];

function isExternalReference(reference) {
  return /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(reference);
}

function resolveLocalReference(reference, pagePath) {
  const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  if (!clean || isExternalReference(clean)) return null;
  let resolved = clean.startsWith('/')
    ? path.resolve(repoRoot, `.${clean}`)
    : path.resolve(repoRoot, path.dirname(pagePath), clean);
  if (clean.endsWith('/') || (existsSync(resolved) && !path.extname(resolved))) resolved = path.join(resolved, 'index.html');
  return resolved;
}

function referencesInTag(tag) {
  const references = [];
  const attributes = /\b(src|href|poster|data-src|data-mobile-src)\s*=\s*(['"])(.*?)\2/gi;
  let match;
  while ((match = attributes.exec(tag))) references.push(match[3]);
  return references;
}

function parseGlb(filePath) {
  const bytes = readFileSync(filePath);
  assert.ok(bytes.length >= 20, `${filePath} is too small for GLB`);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${filePath} has invalid GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${filePath} is not GLB version 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${filePath} GLB length does not match file size`);

  let offset = 12;
  let json;
  let binary;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end <= bytes.length, `${filePath} has a truncated GLB chunk`);
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString('utf8', start, end).replace(/\0+$/g, '').trim());
    if (type === 0x004e4942) binary = { start, length };
    offset = end;
  }
  assert.ok(json, `${filePath} has no JSON chunk`);
  assert.ok(binary, `${filePath} has no embedded binary chunk`);
  for (const buffer of json.buffers ?? []) {
    assert.equal(buffer.uri, undefined, `${filePath} unexpectedly references an external buffer`);
    assert.ok(buffer.byteLength <= binary.length, `${filePath} buffer exceeds the binary chunk`);
  }
  for (const view of json.bufferViews ?? []) {
    const buffer = json.buffers?.[view.buffer ?? 0];
    assert.ok(buffer, `${filePath} has a bufferView with no buffer`);
    assert.ok((view.byteOffset ?? 0) + view.byteLength <= buffer.byteLength, `${filePath} has an out-of-bounds bufferView`);
    if ((view.buffer ?? 0) === 0) {
      assert.ok(binary.start + (view.byteOffset ?? 0) + view.byteLength <= bytes.length, `${filePath} bufferView exceeds the GLB file`);
    }
  }
  for (const image of json.images ?? []) {
    if (image.bufferView !== undefined) {
      assert.ok(json.bufferViews?.[image.bufferView], `${filePath} image references a missing bufferView`);
    } else {
      assert.match(image.uri ?? '', /^data:/i, `${filePath} image is not embedded`);
    }
  }
  return json;
}

test('first-party page asset and module references resolve locally', () => {
  const references = [];
  for (const pagePath of pages) {
    const source = readFileSync(path.join(repoRoot, pagePath), 'utf8');
    const tags = source.match(/<(?:script|link|img|source|iframe|audio|video)\b[^>]*>/gi) ?? [];
    for (const tag of tags) references.push(...referencesInTag(tag).map(reference => ({ pagePath, reference })));
    for (const style of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      for (const match of style[1].matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
        references.push({ pagePath, reference: match[1] });
      }
    }
    for (const match of source.matchAll(/\bimport\s+[^'"]*?\bfrom\s*(['"])([^'"]+)\1/g)) {
      if (match[2].startsWith('.') || match[2].startsWith('/')) references.push({ pagePath, reference: match[2] });
    }
    for (const match of source.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      if (match[2].startsWith('.') || match[2].startsWith('/')) references.push({ pagePath, reference: match[2] });
    }
  }
  const stylesheet = readFileSync(path.join(repoRoot, 'style.css'), 'utf8');
  for (const match of stylesheet.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    references.push({ pagePath: 'index.html', reference: match[1] });
  }
  for (const { pagePath, reference } of references) {
    const resolved = resolveLocalReference(reference, pagePath);
    if (resolved) assert.ok(existsSync(resolved), `${pagePath} references missing local asset ${reference}`);
  }
  assert.ok(existsSync(path.join(repoRoot, 'images/ARtrio_logo_white-01.png')));
});

test('selected desktop/mobile GLBs are valid embedded GLB v2 assets', () => {
  const paths = [
    'mesh_test.glb',
    'mesh_test.mobile.glb',
    'TTY2/400kArtworkonly_glb.glb',
    'TTY2/400kArtworkonly_mobile.glb',
    'EFV/writing.glb',
    'EFV/writing.mobile.glb',
    'NMM/NCB.glb',
    'NMM/NCB.mobile.glb'
  ];
  for (const relativePath of paths) {
    const gltf = parseGlb(path.join(repoRoot, relativePath));
    assert.ok(gltf.meshes?.length, `${relativePath} contains no meshes`);
    assert.ok(gltf.accessors?.length, `${relativePath} contains no accessors`);
  }
});

function parsePly(filePath) {
  const bytes = readFileSync(filePath);
  const headerEnd = bytes.indexOf('end_header');
  assert.ok(headerEnd > 0, `${filePath} is missing a PLY end_header`);
  const lines = bytes.toString('ascii', 0, headerEnd).split(/\r?\n/).filter(line => line.length);
  assert.equal(lines[0], 'ply', `${filePath} is not a PLY file`);
  assert.ok(lines.includes('format binary_little_endian 1.0'), `${filePath} is not binary little-endian PLY`);
  const elements = lines.filter(line => line.startsWith('element '));
  const element = elements[0]?.match(/^element vertex ([1-9]\d*)$/);
  assert.equal(elements.length, 1, `${filePath} must declare exactly one element`);
  assert.ok(element, `${filePath} must declare 'element vertex <positive integer>' and no face element`);
  const count = Number(element[1]);
  assert.deepEqual(
    lines.filter(line => line.startsWith('property ')),
    [
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue'
    ],
    `${filePath} does not contain exactly XYZ float and RGB uchar properties`
  );
  let offset = headerEnd + 'end_header'.length;
  if (bytes[offset] === 13 && bytes[offset + 1] === 10) {
    offset += 2;
  } else if (bytes[offset] === 10) {
    offset += 1;
  } else {
    assert.fail(`${filePath} header is not terminated by exactly one LF or CRLF`);
  }
  assert.equal(bytes.length - offset, count * 15, `${filePath} body length is not vertex count * 15 bytes`);
  return { bytes, offset, count };
}

test('CSLT point clouds are valid binary PLY vertex buffers within desktop/mobile budgets', () => {
  const csltHtml = readFileSync(path.join(repoRoot, 'CSLT/index.html'), 'utf8');
  const viewer = csltHtml.match(/<cslt-point-cloud\b[^>]*>/)?.[0];
  assert.ok(viewer, 'CSLT page is missing its point-cloud viewer');
  const clouds = [
    [viewer.match(/\bdata-src="([^"]+)"/)?.[1], 220000],
    [viewer.match(/\bdata-mobile-src="([^"]+)"/)?.[1], 80000]
  ];
  for (const [reference, budget] of clouds) {
    assert.ok(reference, 'CSLT point-cloud viewer is missing a PLY path');
    const filePath = path.resolve(repoRoot, 'CSLT', reference);
    const { bytes, offset, count } = parsePly(filePath);
    assert.ok(count > 0 && count <= budget, `${reference} has ${count} points, outside its ${budget} budget`);
    const colors = new Set();
    for (let i = 0; i < count; i++) {
      const base = offset + i * 15;
      assert.ok(
        Number.isFinite(bytes.readFloatLE(base)) &&
        Number.isFinite(bytes.readFloatLE(base + 4)) &&
        Number.isFinite(bytes.readFloatLE(base + 8)),
        `${reference} has a non-finite position at vertex ${i}`
      );
      colors.add(bytes.readUIntLE(base + 12, 3));
    }
    assert.ok(colors.size > 100, `${reference} has only ${colors.size} distinct colors`);
  }
});

test('fire shader models provide mapped textures and mesh position/UV attributes', () => {
  for (const relativePath of ['mesh_test.glb', 'mesh_test.mobile.glb', 'EFV/writing.glb', 'EFV/writing.mobile.glb', 'NMM/NCB.glb', 'NMM/NCB.mobile.glb']) {
    const gltf = parseGlb(path.join(repoRoot, relativePath));
    const texturedMaterials = new Set(
      (gltf.materials ?? [])
        .map((material, index) => material.pbrMetallicRoughness?.baseColorTexture ? index : -1)
        .filter(index => index >= 0)
    );
    assert.ok(texturedMaterials.size, `${relativePath} has no base color textures`);
    for (const mesh of gltf.meshes) {
      for (const primitive of mesh.primitives ?? []) {
        assert.ok(primitive.attributes.POSITION !== undefined, `${relativePath} primitive has no positions`);
        assert.ok(primitive.attributes.TEXCOORD_0 !== undefined, `${relativePath} primitive has no UVs`);
      }
    }
  }
});

test('CSLT artwork GLBs are embedded draco fire models within size and triangle budgets', () => {
  const budgets = [
    ['CSLT/Artwork.glb', 330000, 42260, 'image/png'],
    ['CSLT/Artwork.mobile.glb', 200000, 25000, 'image/webp']
  ];
  const stats = {};
  for (const [relativePath, byteBudget, triangleBudget, imageMime] of budgets) {
    const filePath = path.join(repoRoot, relativePath);
    const bytes = statSync(filePath).size;
    assert.ok(bytes <= byteBudget, `${relativePath} is ${bytes} bytes, over its ${byteBudget} budget`);
    const gltf = parseGlb(filePath);
    const primitives = (gltf.meshes ?? []).flatMap(mesh => mesh.primitives ?? []);
    assert.equal(primitives.length, 1, `${relativePath} should contain exactly one draw primitive`);
    const [primitive] = primitives;
    assert.ok((primitive.mode ?? 4) === 4, `${relativePath} primitive is not a triangle draw`);
    assert.ok(primitive.attributes.POSITION !== undefined, `${relativePath} primitive has no positions`);
    assert.ok(primitive.attributes.TEXCOORD_0 !== undefined, `${relativePath} primitive has no UVs`);
    assert.ok(gltf.extensionsRequired?.includes('KHR_draco_mesh_compression'), `${relativePath} does not require KHR_draco_mesh_compression`);
    const triangles = gltf.accessors[primitive.indices].count / 3;
    assert.ok(triangles > 0, `${relativePath} has no indexed triangles`);
    assert.ok(triangles <= triangleBudget, `${relativePath} has ${triangles} triangles, over its ${triangleBudget} budget`);
    const material = gltf.materials[primitive.material];
    assert.ok(material?.pbrMetallicRoughness?.baseColorTexture, `${relativePath} has no fire base-color texture`);
    assert.ok(!material.normalTexture, `${relativePath} still has the original Ink normal map`);
    const texture = gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index];
    const image = gltf.images[texture.extensions?.EXT_texture_webp?.source ?? texture.source];
    assert.ok(image, `${relativePath} base-color texture has no image source`);
    assert.equal(image.mimeType, imageMime, `${relativePath} base-color texture is not ${imageMime}`);
    for (const source of gltf.images ?? []) {
      assert.ok(!/ink|normal|maintexture/i.test(source.name ?? ''), `${relativePath} still contains the original Ink texture ${source.name}`);
    }
    stats[relativePath] = { bytes, triangles };
  }
  assert.ok(stats['CSLT/Artwork.mobile.glb'].bytes < stats['CSLT/Artwork.glb'].bytes, 'mobile artwork should be smaller than desktop');
  assert.ok(stats['CSLT/Artwork.mobile.glb'].triangles < stats['CSLT/Artwork.glb'].triangles, 'mobile artwork should have fewer faces than desktop');
});
