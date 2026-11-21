import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, KHRDracoMeshCompression, KHRTextureTransform } from '@gltf-transform/extensions';
import { cloneDocument, draco, flatten, join, prune, simplify, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';

const directory = fileURLToPath(new URL('.', import.meta.url));
const io = new NodeIO()
  .registerExtensions([EXTTextureWebP, KHRDracoMeshCompression, KHRTextureTransform])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule()
  });
const source = await io.read(path.join(directory, 'Artwork_Mesh.glb'));
await MeshoptSimplifier.ready;

async function build(variant) {
  const filename = `Artwork${variant}.glb`;
  const doc = cloneDocument(source);
  const donor = await io.read(path.join(directory, '..', `mesh_test${variant}.glb`));
  const donorMaterial = donor.getRoot().listMaterials()[0];
  const donorTexture = donorMaterial.getBaseColorTexture();
  const texture = doc.createTexture(donorTexture.getName())
    .setImage(donorTexture.getImage())
    .setMimeType(donorTexture.getMimeType());
  if (texture.getMimeType() === 'image/webp') doc.createExtension(EXTTextureWebP).setRequired(true);

  const material = doc.createMaterial('Artwork Fire')
    .setBaseColorTexture(texture)
    .setDoubleSided(true)
    .setAlphaMode('BLEND')
    .setMetallicFactor(0);
  const sampler = donorMaterial.getBaseColorTextureInfo();
  material.getBaseColorTextureInfo()
    .setWrapS(sampler.getWrapS())
    .setWrapT(sampler.getWrapT())
    .setMinFilter(sampler.getMinFilter())
    .setMagFilter(sampler.getMagFilter());

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (!primitive.getAttribute('TEXCOORD_0')) throw new Error(`${mesh.getName()} has no fire texture coordinates`);
      primitive.setMaterial(material);
      for (const semantic of primitive.listSemantics()) {
        if (semantic !== 'POSITION' && semantic !== 'TEXCOORD_0') primitive.setAttribute(semantic, null);
      }
    }
  }

  await doc.transform(flatten(), join(), prune(), weld({ overwrite: true }));
  if (variant) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.001 }));
  await doc.transform(draco({ quantizePosition: 14, quantizeTexcoord: 12 }));
  return { filename, bytes: await io.writeBinary(doc) };
}

for (const { filename, bytes } of [await build(''), await build('.mobile')]) {
  await writeFile(path.join(directory, filename), bytes);
  console.log(`${filename}: ${bytes.byteLength} bytes`);
}
