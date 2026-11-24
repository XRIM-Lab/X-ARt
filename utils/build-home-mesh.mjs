import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { cloneDocument, draco, flatten, join, prune, simplify, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import convert from 'fbx2gltf';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = fileURLToPath(new URL('..', import.meta.url));
const fbx = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'source-assets', 'OfflineLineContainerPrefab(Clone).fbx');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule()
});

async function build(source, suffix) {
  const doc = cloneDocument(source);
  const donor = await io.read(path.join(root, `mesh_test${suffix}.glb`));
  const donorMaterial = donor.getRoot().listMaterials().find(material => material.getBaseColorTexture());
  const donorTexture = donorMaterial.getBaseColorTexture();
  const texture = doc.createTexture('fire')
    .setImage(donorTexture.getImage())
    .setMimeType(donorTexture.getMimeType());
  if (texture.getMimeType() === 'image/webp') doc.createExtension(EXTTextureWebP).setRequired(true);
  const material = doc.createMaterial('Homepage Fire')
    .setBaseColorTexture(texture)
    .setAlphaMode('BLEND')
    .setDoubleSided(true)
    .setMetallicFactor(0);
  const sampler = donorMaterial.getBaseColorTextureInfo();
  material.getBaseColorTextureInfo()
    .setWrapS(sampler.getWrapS())
    .setWrapT(sampler.getWrapT())
    .setMinFilter(sampler.getMinFilter())
    .setMagFilter(sampler.getMagFilter());

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (!primitive.getAttribute('TEXCOORD_0')) throw new Error(`${mesh.getName()} has no fire UVs`);
      primitive.setMaterial(material);
      for (const semantic of primitive.listSemantics()) {
        if (semantic !== 'POSITION' && semantic !== 'TEXCOORD_0') primitive.setAttribute(semantic, null);
      }
    }
  }
  await doc.transform(flatten(), join(), prune(), weld({ overwrite: true }));
  if (suffix) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.32, error: 0.005 }));
  const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  if (primitives.length !== 1) throw new Error(`Expected one fire draw primitive; got ${primitives.length}`);
  const triangles = primitives[0].getIndices().getCount() / 3;
  await doc.transform(draco({ quantizePosition: 14, quantizeTexcoord: 12 }));
  const bytes = await io.writeBinary(doc);
  return { filename: `mesh_index${suffix}.glb`, bytes, triangles };
}

const temp = await mkdtemp(path.join(os.tmpdir(), 'artrio-home-mesh-'));
try {
  const converted = path.join(temp, 'source.glb');
  await convert(fbx, converted);
  const source = await io.read(converted);
  const desktop = await build(source, '');
  const mobile = await build(source, '.mobile');
  if (mobile.triangles >= desktop.triangles || mobile.bytes.length >= desktop.bytes.length) {
    throw new Error('Mobile mesh must have fewer triangles and be smaller than desktop');
  }
  for (const { filename, bytes, triangles } of [desktop, mobile]) {
    await writeFile(path.join(root, filename), bytes);
    console.log(`${filename}: ${triangles} triangles, ${bytes.length} bytes`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
