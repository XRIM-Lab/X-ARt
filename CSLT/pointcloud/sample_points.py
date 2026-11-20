import heapq
import math
import mmap
import os
import struct
from collections import Counter
from pathlib import Path
from random import Random


SOURCE_NAME = "sshop2-better-edit.ply"
DESKTOP_BUDGET = 220_000
MOBILE_BUDGET = 80_000
REGION_SIZE = 0.125
DENSITY_EXPONENT = 0.8
MIN_OPACITY_LOGIT = math.log(0.10 / 0.90)
DC_FACTOR = 0.28209479177387814
FLOAT = struct.Struct("<f")
POINT = struct.Struct("<fffBBB")
REQUIRED = ("x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity")


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


def region_key(x, y, z):
    return tuple(math.floor(value / REGION_SIZE) for value in (x, y, z))


def allocate_budgets(counts, desktop_budget, mobile_budget):
    inverse_weights = {key: count ** -DENSITY_EXPONENT for key, count in counts.items()}
    queue = [(0.5 * weight, key) for key, weight in inverse_weights.items()]
    heapq.heapify(queue)
    desktop, mobile = Counter(), Counter()
    for index in range(min(desktop_budget, sum(counts.values()))):
        _, key = heapq.heappop(queue)
        desktop[key] += 1
        if index < mobile_budget:
            mobile[key] += 1
        if desktop[key] < counts[key]:
            heapq.heappush(queue, ((desktop[key] + 0.5) * inverse_weights[key], key))
    return desktop, mobile


def sample_clouds(data, header):
    counts = Counter(region_key(x, y, z) for _, x, y, z, _ in accepted_points(data, header))
    if not counts:
        raise ValueError("No usable points")
    desktop_quotas, mobile_quotas = allocate_budgets(counts, DESKTOP_BUDGET, MOBILE_BUDGET)
    samples = {key: [] for key in desktop_quotas}
    random = Random(0).random
    for start, x, y, z, opacity in accepted_points(data, header):
        key = region_key(x, y, z)
        if key not in samples:
            continue
        weight = 0.25 + 1 / (1 + math.exp(-opacity))
        candidate = (math.log1p(-random()) / weight, start)
        heap = samples[key]
        if len(heap) < desktop_quotas[key]:
            heapq.heappush(heap, candidate)
        elif candidate > heap[0]:
            heapq.heapreplace(heap, candidate)
    desktop, mobile = [], []
    for key, heap in samples.items():
        desktop.extend(start for _, start in heap)
        mobile.extend(start for _, start in heapq.nlargest(mobile_quotas[key], heap))
    return desktop, mobile


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
        for start in sorted(points):
            x, y, z, r, g, b = (read(data, start + field)[0] for field in fields[:6])
            out.write(POINT.pack(x, y, z, rgb_byte(r), rgb_byte(g), rgb_byte(b)))


def main():
    directory = Path(__file__).resolve().parent
    with (directory / SOURCE_NAME).open("rb") as source:
        header = read_header(source)
        with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
            desktop, mobile = sample_clouds(data, header)
            for filename, points in (("shop.ply", desktop), ("shop.mobile.ply", mobile)):
                path = directory / filename
                write_ply(path, points, data, header[3])
                print(f"{filename}: {len(points):,} points, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
