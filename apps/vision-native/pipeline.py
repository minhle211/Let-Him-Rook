"""
Hand + pose landmark pipeline on CoreML (FP16, Apple Neural Engine).

The four networks are MediaPipe's hand/pose landmarker models converted to CoreML. The
pre/post-processing mirrors MediaPipe's graphs: SSD anchors, weighted NMS, rotated ROI crops,
heatmap refinement and landmark->ROI tracking (detectors only run when tracking is lost).
"""
import math
import os

import cv2
import numpy as np

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
NAMES = ('hand_detector', 'hand_landmarks_detector', 'pose_detector', 'pose_landmarks_detector')


class CoreMLModels:
    def __init__(self, compute_unit='CPU_AND_NE'):
        import coremltools as ct
        self.m = {}
        for name in NAMES:
            m = ct.models.MLModel(os.path.join(MODEL_DIR, f'{name}_fp16.mlpackage'), compute_units=getattr(ct.ComputeUnit, compute_unit))
            self.m[name] = (m, [o.name for o in m.get_spec().description.output])  # MediaPipe output order

    def run(self, name, x):
        m, outs = self.m[name]
        res = m.predict({'input': x})
        return [np.asarray(res[o]) for o in outs]


# ---------------------------------------------------------------- geometry
def ssd_anchors(size, strides):
    """MediaPipe SsdAnchorsCalculator: fixed anchor size, aspect 1.0 + interpolated scale (2 anchors per layer)."""
    anchors, i = [], 0
    while i < len(strides):
        j = i
        while j < len(strides) and strides[j] == strides[i]:
            j += 1
        fm = math.ceil(size / strides[i])
        for y in range(fm):
            for x in range(fm):
                anchors.extend([((x + 0.5) / fm, (y + 0.5) / fm)] * (2 * (j - i)))
        i = j
    return np.array(anchors, np.float32)


PALM_ANCHORS = ssd_anchors(192, [8, 16, 16, 16])        # 2016
POSE_ANCHORS = ssd_anchors(224, [8, 16, 32, 32, 32])    # 2254


def normalize(img_u8, rng):
    lo, hi = rng
    return (img_u8.astype(np.float32) * ((hi - lo) / 255.0) + lo)[None]


def letterbox(rgb, size, rng):
    h, w = rgb.shape[:2]
    s = size / max(h, w)
    nw, nh = round(w * s), round(h * s)
    canvas = np.zeros((size, size, 3), np.uint8)
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas[py:py + nh, px:px + nw] = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return normalize(canvas, rng), (nw / size, nh / size, px / size, py / size)


def unletterbox(pts, lb):
    sx, sy, px, py = lb
    pts = np.asarray(pts, np.float32).copy()
    pts[..., 0] = (pts[..., 0] - px) / sx
    pts[..., 1] = (pts[..., 1] - py) / sy
    return pts


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0


def weighted_nms(dets, thresh):
    dets = sorted(dets, key=lambda d: -d['score'])
    out = []
    while dets:
        top = dets[0]
        group = [d for d in dets if iou(top['box'], d['box']) > thresh]
        dets = [d for d in dets if iou(top['box'], d['box']) <= thresh]
        wsum = sum(d['score'] for d in group)
        out.append(dict(score=top['score'],
                        box=sum(d['box'] * d['score'] for d in group) / wsum,
                        kps=sum(d['kps'] * d['score'] for d in group) / wsum))
    return out


def decode_detections(raw_boxes, raw_scores, anchors, size, n_kp, thresh=0.5):
    scores = 1 / (1 + np.exp(-np.clip(raw_scores.reshape(-1).astype(np.float64), -100, 100)))
    keep = scores > thresh
    if not keep.any():
        return []
    b, a, sc = raw_boxes.reshape(len(anchors), -1)[keep], anchors[keep], scores[keep]
    cx, cy = b[:, 0] / size + a[:, 0], b[:, 1] / size + a[:, 1]
    w, h = b[:, 2] / size, b[:, 3] / size
    kps = np.stack([b[:, 4 + 2 * k:6 + 2 * k] / size + a for k in range(n_kp)], 1)
    dets = [dict(score=float(sc[i]), box=np.array([cx[i] - w[i] / 2, cy[i] - h[i] / 2, cx[i] + w[i] / 2, cy[i] + h[i] / 2]), kps=kps[i])
            for i in range(len(sc))]
    return weighted_nms(dets, 0.3)


def norm_angle(a):
    return a - 2 * math.pi * math.floor((a + math.pi) / (2 * math.pi))


def rotation(p0, p1, W, H, target=math.pi / 2):
    return norm_angle(target - math.atan2(-(p1[1] - p0[1]) * H, (p1[0] - p0[0]) * W))


def transform_rect(r, W, H, scale, shift_y=0.0):
    """MediaPipe RectTransformationCalculator with square_long."""
    cx, cy, w, h, rot = r
    if shift_y:
        cx += (-H * h * shift_y * math.sin(rot)) / W
        cy += (H * h * shift_y * math.cos(rot)) / H
    long = max(w * W, h * H)
    return (cx, cy, long / W * scale, long / H * scale, rot)


def crop(rgb, r, size, rng):
    H, W = rgb.shape[:2]
    cx, cy, w, h, rot = r
    c, s = math.cos(rot), math.sin(rot)
    hw, hh = w * W / 2, h * H / 2

    def corner(dx, dy):
        return (cx * W + dx * c - dy * s, cy * H + dx * s + dy * c)

    src = np.float32([corner(-hw, -hh), corner(hw, -hh), corner(-hw, hh)])
    M = cv2.getAffineTransform(src, np.float32([[0, 0], [size, 0], [0, size]]))
    warped = cv2.warpAffine(rgb, M, (size, size), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return normalize(warped, rng)


def project(lm_px, r, size, W, H):
    """Crop-pixel landmarks -> frame pixels."""
    cx, cy, w, h, rot = r
    c, s = math.cos(rot), math.sin(rot)
    dx = (lm_px[:, 0] / size - 0.5) * w * W
    dy = (lm_px[:, 1] / size - 0.5) * h * H
    return np.stack([cx * W + dx * c - dy * s, cy * H + dx * s + dy * c], 1)


def refine_from_heatmap(lm, heatmap, size, kernel=7, min_conf=0.5):
    """MediaPipe RefineLandmarksFromHeatmapCalculator."""
    hm_h, hm_w, _ = heatmap.shape
    off = (kernel - 1) // 2
    for i in range(lm.shape[0]):
        col, row = int(lm[i, 0] / size * hm_w), int(lm[i, 1] / size * hm_h)
        if not (0 <= col < hm_w and 0 <= row < hm_h):
            continue
        r0, r1, c0, c1 = max(0, row - off), min(hm_h, row + off + 1), max(0, col - off), min(hm_w, col + off + 1)
        conf = 1 / (1 + np.exp(-heatmap[r0:r1, c0:c1, i].astype(np.float64)))
        if conf.max() < min_conf or conf.sum() <= 0:
            continue
        rows, cols = np.mgrid[r0:r1, c0:c1]
        lm[i, 0] = ((cols * conf).sum() / conf.sum() + 0.5) / hm_w * size
        lm[i, 1] = ((rows * conf).sum() / conf.sum() + 0.5) / hm_h * size
    return lm


HAND_SUBSET = [0, 1, 2, 3, 5, 6, 9, 10, 13, 14, 17, 18]


def hand_rect_from_landmarks(pts, W, H):
    """MediaPipe HandLandmarksToRectCalculator + RectTransformation(scale 2.0, shift_y -0.1)."""
    n = pts / np.array([W, H])
    x1, y1 = (n[5] + n[13]) / 2
    x1, y1 = (x1 + n[9][0]) / 2, (y1 + n[9][1]) / 2
    rot = rotation(n[0], (x1, y1), W, H)
    sub = pts[HAND_SUBSET]
    c, s = math.cos(-rot), math.sin(-rot)
    center = sub.mean(0)
    rel = sub - center
    rx = rel[:, 0] * c - rel[:, 1] * s
    ry = rel[:, 0] * s + rel[:, 1] * c
    mid = np.array([(rx.min() + rx.max()) / 2, (ry.min() + ry.max()) / 2])
    c2, s2 = math.cos(rot), math.sin(rot)
    ctr = center + np.array([mid[0] * c2 - mid[1] * s2, mid[0] * s2 + mid[1] * c2])
    r = (ctr[0] / W, ctr[1] / H, (rx.max() - rx.min()) / W, (ry.max() - ry.min()) / H, rot)
    return transform_rect(r, W, H, 2.0, -0.1)


def rect_iou(a, b, W, H):
    def box(r):
        hw = max(r[2] * W, r[3] * H) / 2
        return (r[0] * W - hw, r[1] * H - hw, r[0] * W + hw, r[1] * H + hw)
    return iou(box(a), box(b))


def rect_from_alignment(c, s, W, H):
    """MediaPipe AlignmentPointsRectsCalculator + RectTransformation(scale 1.25)."""
    size = 2 * math.hypot((s[0] - c[0]) * W, (s[1] - c[1]) * H)
    return transform_rect((c[0], c[1], size / W, size / H, rotation(c, s, W, H)), W, H, 1.25)


# ---------------------------------------------------------------- pipeline
class Pipeline:
    """Stateful per-camera tracker. Landmark outputs: frame pixels (x, y) plus MediaPipe-style z."""

    def __init__(self, models, num_hands=2):
        self.m = models
        self.num_hands = num_hands
        self.hand_rects = []
        self.pose_rect = None

    def reset(self):
        self.hand_rects = []
        self.pose_rect = None

    def hands(self, rgb):
        H, W = rgb.shape[:2]
        rects = list(self.hand_rects)
        if len(rects) < self.num_hands:  # MediaPipe re-detects while fewer than num_hands are tracked
            x, lb = letterbox(rgb, 192, (0, 1))
            boxes, scores = self.m.run('hand_detector', x)
            for d in decode_detections(boxes, scores, PALM_ANCHORS, 192, 7):
                bx = unletterbox(d['box'].reshape(2, 2), lb).reshape(-1)
                kp = unletterbox(d['kps'], lb)
                r = ((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, bx[2] - bx[0], bx[3] - bx[1], rotation(kp[0], kp[2], W, H))
                r = transform_rect(r, W, H, 2.6, -0.5)
                if all(rect_iou(r, t, W, H) < 0.5 for t in rects):
                    rects.append(r)
                if len(rects) >= self.num_hands:
                    break
        out, tracked = [], []
        for r in rects[:self.num_hands]:
            lms, presence, _handed, _world = self.m.run('hand_landmarks_detector', crop(rgb, r, 224, (0, 1)))
            if presence.item() < 0.5:
                continue
            lm = lms.reshape(21, 3)
            pts = project(lm[:, :2], r, 224, W, H)
            z = lm[:, 2] / 224 * r[2]  # MediaPipe: z normalized like x by the ROI width
            out.append(np.concatenate([pts, z[:, None]], 1))
            tracked.append(hand_rect_from_landmarks(pts, W, H))
        self.hand_rects = tracked
        return out

    def pose(self, rgb):
        H, W = rgb.shape[:2]
        r = self.pose_rect
        if r is None:
            x, lb = letterbox(rgb, 224, (-1, 1))
            boxes, scores = self.m.run('pose_detector', x)
            dets = decode_detections(boxes, scores, POSE_ANCHORS, 224, 4)
            if not dets:
                return None
            kp = unletterbox(dets[0]['kps'], lb)
            r = rect_from_alignment(kp[0], kp[1], W, H)
        lms, presence, _mask, heatmap, _world = self.m.run('pose_landmarks_detector', crop(rgb, r, 256, (0, 1)))
        if presence.item() < 0.5:
            self.pose_rect = None
            return None
        lm = refine_from_heatmap(lms.reshape(39, 5).copy(), heatmap.reshape(64, 64, 39), 256)
        pts = project(lm[:, :2], r, 256, W, H)
        z = lm[:33, 2] / 256 * r[2]
        vis = 1 / (1 + np.exp(-lm[:33, 3]))
        self.pose_rect = rect_from_alignment(pts[33] / [W, H], pts[34] / [W, H], W, H)  # auxiliary landmarks
        return np.concatenate([pts[:33], z[:, None], vis[:, None]], 1)
