import struct
import unittest
from unittest.mock import patch

import numpy as np

import sample_points

FIELDS = (0, 4, 8, 12, 16, 20, 24)
OPAQUE = 0.0
LOW_OPACITY = -10.0


def pack_buffer(rows, offset=24, floats_per_row=10):
    stride = floats_per_row * 4
    data = bytearray(offset + stride * len(rows))
    for index, row in enumerate(rows):
        values = [float("nan")] * floats_per_row
        values[:7] = row
        struct.pack_into(f"<{floats_per_row}f", data, offset + index * stride, *values)
    return bytes(data), (offset, stride, len(rows), FIELDS)


class SpatiallySupportedTests(unittest.TestCase):
    def test_dense_points_spanning_origin_all_survive(self):
        positions = np.array([
            [-0.02, 0.0, 0.0],
            [0.02, 0.0, 0.0],
            [0.0, -0.02, 0.0],
            [0.0, 0.02, 0.0]
        ])
        self.assertTrue(sample_points.spatially_supported(positions).all())

    def test_pair_speck_and_empty_input_fail(self):
        pair = np.array([[0.0, 0.0, 0.0], [0.01, 0.0, 0.0]])
        self.assertFalse(sample_points.spatially_supported(pair).any())
        with_speck = np.array([
            [0.0, 0.0, 0.0],
            [0.01, 0.0, 0.0],
            [0.0, 0.01, 0.0],
            [0.0, 0.0, 0.01],
            [5.0, 0.0, 0.0]
        ])
        mask = sample_points.spatially_supported(with_speck)
        self.assertTrue(mask[:4].all())
        self.assertFalse(mask[4])
        empty = np.zeros((0, 3))
        self.assertEqual(sample_points.spatially_supported(empty).size, 0)

    def test_radius_boundary_is_inclusive_and_excludes_self(self):
        anchor = [[0.0, 0.0, 0.0]]
        positions = np.array(anchor + [[0.05, 0.0, 0.0], [0.01, 0.0, 0.0], [0.02, 0.0, 0.0]])
        self.assertTrue(sample_points.spatially_supported(positions)[0])
        positions[1] = [0.0501, 0.0, 0.0]
        self.assertFalse(sample_points.spatially_supported(positions)[0])
        two_neighbors = np.array(anchor + [[0.01, 0.0, 0.0], [0.02, 0.0, 0.0], [1.0, 0.0, 0.0]])
        self.assertFalse(sample_points.spatially_supported(two_neighbors)[0])


class AcceptedIndicesTests(unittest.TestCase):
    def test_screens_and_returns_retained_source_rows(self):
        rows = [
            (0.00, 0.00, 0.00, 0, 0, 0, OPAQUE),
            (0.01, 0.00, 0.00, 0, 0, 0, OPAQUE),
            (0.00, 0.01, 0.00, 0, 0, 0, OPAQUE),
            (0.00, 0.00, 0.01, 0, 0, 0, OPAQUE),
            (10.0, 0.00, 0.00, 0, 0, 0, OPAQUE),
            (5.00, 0.00, 0.00, 0, 0, 0, OPAQUE),
            (5.01, 0.00, 0.00, 0, 0, 0, LOW_OPACITY),
            (5.00, 0.01, 0.00, 0, 0, 0, LOW_OPACITY),
            (5.00, 0.00, 0.01, 0, 0, 0, LOW_OPACITY),
            (5.02, 0.00, 0.00, 0, 0, 0, float("nan")),
            (5.00, -0.01, 0.0, float("nan"), 0, 0, OPAQUE),
            (float("nan"), 0.0, 0.0, 0, 0, 0, OPAQUE)
        ]
        data, header = pack_buffer(rows)
        indices = sample_points.accepted_indices(data, header)
        self.assertIsInstance(indices, np.ndarray)
        np.testing.assert_array_equal(indices, [0, 1, 2, 3])


class SampleCloudsTests(unittest.TestCase):
    def test_budgets_deterministic_subset_and_only_good_rows(self):
        rows = [
            (0.005 * index, 0.0, 0.0, 1, 0, 0, OPAQUE) for index in range(6)
        ] + [
            (10.0, 0.0, 0.0, 0, 0, 0, OPAQUE),
            (0.02, 0.0, 0.0, 0, 0, 0, LOW_OPACITY),
            (0.03, 0.0, 0.0, 0, 0, 0, float("nan"))
        ]
        data, header = pack_buffer(rows)
        offset, stride = header[0], header[1]
        good_starts = {offset + index * stride for index in range(6)}
        with patch.object(sample_points, "DESKTOP_BUDGET", 4), \
                patch.object(sample_points, "MOBILE_BUDGET", 2):
            desktop, mobile = sample_points.sample_clouds(data, header)
            again_desktop, again_mobile = sample_points.sample_clouds(data, header)
        self.assertEqual(len(desktop), 4)
        self.assertEqual(len(mobile), 2)
        self.assertEqual(desktop, again_desktop)
        self.assertEqual(mobile, again_mobile)
        self.assertTrue(set(mobile).issubset(set(desktop)))
        self.assertTrue(set(desktop).issubset(good_starts))
        self.assertTrue(all((start - offset) % stride == 0 for start in desktop + mobile))


if __name__ == "__main__":
    unittest.main()
