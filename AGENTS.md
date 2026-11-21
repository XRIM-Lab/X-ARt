# CSLT point-cloud assets

- To regenerate `CSLT/pointcloud/shop.ply` and `shop.mobile.ply`, place the original `sshop2-better-edit.ply` in `CSLT/pointcloud/` (the source is gitignored). With Python 3.12 or newer, run `python -m pip install -r CSLT/pointcloud/requirements.txt` in your Python environment, then `python -B CSLT/pointcloud/sample_points.py` from the repo root. This overwrites the two generated assets, not the source.
- Check preprocessing with `python -B -m unittest discover -s CSLT/pointcloud -v` and the generated asset format with `node --test tests/assets.test.mjs`.

# CSLT artwork assets

- With the locked npm dependencies installed, run `node CSLT/build-artwork.mjs` from the repo root. It merges the geometry from `CSLT/Artwork_Mesh.glb` and builds `CSLT/Artwork.glb` and `CSLT/Artwork.mobile.glb` with the existing homepage fire textures. It leaves the source mesh and homepage GLBs unchanged.
- Verify the assets with `node --test tests/assets.test.mjs` and the integration with `npm run test:e2e -- --grep "CSLT renders its responsive scan"`.
