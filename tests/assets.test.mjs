import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  'index.html',
  'TTY2/index.html',
  'EFV/index.html',
  'NMM/index.html'
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
      references.push({ pagePath, reference: match[2] });
    }
    for (const match of source.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      references.push({ pagePath, reference: match[2] });
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
    'EFV/writing.glb'
  ];
  for (const relativePath of paths) {
    const gltf = parseGlb(path.join(repoRoot, relativePath));
    assert.ok(gltf.meshes?.length, `${relativePath} contains no meshes`);
    assert.ok(gltf.accessors?.length, `${relativePath} contains no accessors`);
  }
});

test('fire shader models provide mapped textures and mesh position/UV attributes', () => {
  for (const relativePath of ['mesh_test.glb', 'mesh_test.mobile.glb', 'EFV/writing.glb']) {
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
