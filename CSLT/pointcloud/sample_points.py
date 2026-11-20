import math
import mmap
import os
import struct
from pathlib import Path


SOURCE_NAME = "sshop2-better-edit.ply"
DESKTOP_BUDGET = 220_000
MOBILE_BUDGET = 80_000
GRID_BITS = 9
GRID_SIZE = 1 << GRID_BITS
MIN_OPACITY_LOGIT = math.log(0.10 / 0.90)
DC_FACTOR = 0.28209479177387814
FLOAT = struct.Struct("<f")
POINT = struct.Struct("<fffBBB")
REQUIRED = ("x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity")
SPREAD = tuple(sum(((i >> bit) & 1) << (3 * bit) for bit in range(GRID_BITS))
               for i in range(GRID_SIZE))


def read_header(source):
    if source.readline(4096).strip() != b"ply":
        raise ValueError("Not a PLY file")
    if source.readline(4096).strip() != b"format binary_little_endian 1.0":
        raise ValueError("Expected a binary little-endian PLY")
    count = None
    properties = {}
    while source.tell() < 64 * 1024:
        line = source.readline(4096)
        tokens = line.strip().split()
        if not line or not line.endswith(b"\n"):
            break
        if not tokens or tokens[0] in (b"comment", b"obj_info"):
            continue
        if tokens == [b"end_header"]:
            if not count or any(name not in properties for name in REQUIRED):
                raise ValueError("Missing vertices or required 3DGS vertex properties")
            offset = source.tell()
            stride = len(properties) * FLOAT.size
            if os.fstat(source.fileno()).st_size != offset + count * stride:
                raise ValueError("PLY byte length does not match its vertex layout")
            return offset, stride, count, tuple(properties[name] for name in REQUIRED)
        if len(tokens) == 3 and tokens[:2] == [b"element", b"vertex"] and count is None:
            count = int(tokens[2])
            if count < 1:
                raise ValueError("Expected a positive PLY vertex count")
        elif len(tokens) == 3 and tokens[0] == b"property" and tokens[1] in (b"float", b"float32") and count is not None:
            name = tokens[2].decode("ascii")
            if name in properties:
                raise ValueError(f"Duplicate vertex property: {name}")
            properties[name] = len(properties) * FLOAT.size
        else:
            raise ValueError("Expected a single vertex element containing float properties")
    raise ValueError("Missing or oversized PLY header")


def accepted_points(data, header):
    offset, stride, count, fields = header
    read = FLOAT.unpack_from
    ox, oy, oz, ore, og, ob, oo = fields
    for index in range(count):
        start = offset + index * stride
        opacity = read(data, start + oo)[0]
        if not math.isfinite(opacity) or opacity < MIN_OPACITY_LOGIT:
            continue
        x, y, z = read(data, start + ox)[0], read(data, start + oy)[0], read(data, start + oz)[0]
        r, g, b = read(data, start + ore)[0], read(data, start + og)[0], read(data, start + ob)[0]
        if all(map(math.isfinite, (x, y, z, r, g, b))):
            yield start, x, y, z, opacity


def voxel_candidates(data, header):
    xmin = ymin = zmin = math.inf
    xmax = ymax = zmax = -math.inf
    for _, x, y, z, _ in accepted_points(data, header):
        xmin, ymin, zmin = min(xmin, x), min(ymin, y), min(zmin, z)
        xmax, ymax, zmax = max(xmax, x), max(ymax, y), max(zmax, z)
    extent = max(xmax - xmin, ymax - ymin, zmax - zmin)
    if not math.isfinite(extent) or extent <= 0:
        raise ValueError("No usable 3D point extent")
    scale = (GRID_SIZE - 1) / extent
    candidates = {}
    for start, x, y, z, opacity in accepted_points(data, header):
        ix = min(GRID_SIZE - 1, int((x - xmin) * scale))
        iy = min(GRID_SIZE - 1, int((y - ymin) * scale))
        iz = min(GRID_SIZE - 1, int((z - zmin) * scale))
        key = SPREAD[ix] | (SPREAD[iy] << 1) | (SPREAD[iz] << 2)
        current = candidates.get(key)
        if current is None or opacity > current[0]:
            candidates[key] = opacity, start
    return [(key, opacity, start) for key, (opacity, start) in candidates.items()]


def sample(candidates, budget):
    if len(candidates) <= budget:
        return candidates
    finer = candidates
    for shift in range(3, 3 * GRID_BITS + 1, 3):
        cells = {}
        for point in finer:
            key, opacity, start = point
            cell = key >> shift
            current = cells.get(cell)
            if current is None or (opacity, -start) > (current[1], -current[2]):
                cells[cell] = point
        if len(cells) <= budget:
            coarse = list(cells.values())
            chosen = {point[0] for point in coarse}
            extra = sorted((point for point in finer if point[0] not in chosen),
                           key=lambda point: (point[0] * 0x9E3779B1) & 0xFFFFFFFF)
            return coarse + extra[:budget - len(coarse)]
        finer = list(cells.values())
    raise ValueError("Could not reduce cloud to its point budget")


def rgb_byte(coefficient):
    return round(255 * max(0.0, min(1.0, 0.5 + DC_FACTOR * coefficient)))


def write_ply(path, points, data, fields):
    with path.open("wb") as out:
        out.write((
            f"ply\nformat binary_little_endian 1.0\nelement vertex {len(points)}\n"
            "property float x\nproperty float y\nproperty float z\n"
            "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
        ).encode("ascii"))
        read = FLOAT.unpack_from
        for _, _, start in sorted(points):
            x, y, z, r, g, b = (read(data, start + field)[0] for field in fields[:6])
            out.write(POINT.pack(x, y, z, rgb_byte(r), rgb_byte(g), rgb_byte(b)))


def main():
    directory = Path(__file__).resolve().parent
    with (directory / SOURCE_NAME).open("rb") as source:
        header = read_header(source)
        with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
            desktop = sample(voxel_candidates(data, header), DESKTOP_BUDGET)
            mobile = sample(desktop, MOBILE_BUDGET)
            for filename, points in (("shop.ply", desktop), ("shop.mobile.ply", mobile)):
                path = directory / filename
                write_ply(path, points, data, header[3])
                print(f"{filename}: {len(points):,} points, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
