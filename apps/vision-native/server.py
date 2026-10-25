"""
Native vision helper: camera -> CoreML (Neural Engine) hand + pose landmarks -> WebSocket.

The game's browser client connects to ws://127.0.0.1:<port> and receives landmarks in the same
normalized, mirrored format the old in-browser MediaPipe worker produced.

usage: server.py [--port 3101] [--source 0 | path/to/video] [--loop]
"""
import argparse
import asyncio
import ipaddress
import json
import os
import sys
import threading
import time
from urllib.parse import urlparse

import cv2
import numpy as np
from websockets.asyncio.server import broadcast, serve

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with python -I
from pipeline import CoreMLModels, Pipeline
import camera as maccam

BRIGHTNESS_SAMPLE_EVERY = 12
BLACK_FRAME_LEVEL = 2.0      # mean pixel value: effectively a black frame
BLACK_FRAME_ALERT_S = 3.0
LOW_LIGHT_THRESHOLD = 38
MODES = ('chess', 'duel_pose_only', 'duel_full')


def allowed_origin(origin):
    """Only game pages on this machine or the local network may read the camera landmarks."""
    if origin is None:
        return True  # non-browser clients (tests, CLI)
    host = urlparse(origin).hostname or ''
    if host in ('localhost', '127.0.0.1', '::1'):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip in ipaddress.ip_network('100.64.0.0/10')  # CGNAT (e.g. eduroam)


class VisionLoop(threading.Thread):
    def __init__(self, source, loop_video, publish):
        super().__init__(daemon=True)
        self.source, self.loop_video, self.publish = source, loop_video, publish
        self.is_video_file = isinstance(source, str) and os.path.isfile(source)
        self.mode = 'duel_full'
        self.status = {'type': 'status', 'status': 'loading'}
        self.stopped = False

    def set_status(self, status, **extra):
        self.status = {'type': 'status', 'status': status, **extra}
        self.publish(self.status)

    def open_camera(self):
        """Live camera via native AVFoundation (OpenCV's macOS camera backend returns black frames)."""
        status = maccam.authorization_status()
        if status == 'notDetermined':
            print('[vision] Asking macOS for camera access (approve the prompt)...', flush=True)
            maccam.request_access()
            status = maccam.authorization_status()
        if status != 'authorized':
            raise RuntimeError('Camera access is blocked for the app running this terminal (Terminal / VS Code). '
                               'Enable it in System Settings > Privacy & Security > Camera, then restart that app.')
        selector = self.source if isinstance(self.source, int) and self.source != 0 else (None if isinstance(self.source, int) else self.source)
        return maccam.MacCamera(selector)

    def run(self):
        t0 = time.perf_counter()
        models = CoreMLModels('CPU_AND_NE')
        pipe = Pipeline(models)
        print(f'[vision] CoreML models loaded on the Neural Engine in {time.perf_counter() - t0:.1f}s', flush=True)

        cap = None
        frame_idx, low_light, fps, last_out = 0, False, 0.0, None
        video_fps = None
        next_due = 0.0  # deadline pacing for video-file sources (self-corrects sleep overshoot)
        while not self.stopped:
            if cap is None:
                try:
                    if self.is_video_file:
                        cap = cv2.VideoCapture(self.source)
                        if not cap.isOpened():
                            raise RuntimeError(f'Cannot open video {self.source}')
                        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30
                        label = self.source
                    else:
                        cap = self.open_camera()
                        video_fps = None
                        label = cap.name
                except Exception as err:
                    cap = None
                    print(f'[vision] {err}', flush=True)
                    self.set_status('error', error=str(err))
                    time.sleep(2)
                    continue
                black_since = None
                print(f'[vision] capturing from {label}', flush=True)
                self.set_status('ready', delegate='ANE', camera=label)

            if self.is_video_file:
                ok, bgr = cap.read()
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB) if ok else None
            else:
                ok, rgb = cap.read()
            if not ok:
                if self.is_video_file and self.loop_video:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    pipe.reset()
                    continue
                cap.release()
                cap = None
                continue

            # A camera that delivers only black frames is a permission/hardware problem, not "no person".
            if float(rgb[::16, ::16].mean()) < BLACK_FRAME_LEVEL:
                black_since = black_since or time.perf_counter()
                if time.perf_counter() - black_since > BLACK_FRAME_ALERT_S and self.status.get('status') != 'error':
                    msg = 'Camera frames are black (lens covered, privacy shutter, or camera access blocked for this terminal app).'
                    print(f'[vision] {msg}', flush=True)
                    self.set_status('error', error=msg)
            elif black_since is not None:
                black_since = None
                if self.status.get('status') == 'error':
                    self.set_status('ready', delegate='ANE', camera=label)
            H, W = rgb.shape[:2]
            t = time.perf_counter()
            mode = self.mode
            hands = pipe.hands(rgb) if mode != 'duel_pose_only' else []
            pose = pipe.pose(rgb) if mode != 'chess' else None
            inference_ms = (time.perf_counter() - t) * 1000

            if frame_idx % BRIGHTNESS_SAMPLE_EVERY == 0:
                small = cv2.resize(rgb, (64, 48), interpolation=cv2.INTER_AREA)
                low_light = float(small.mean()) < LOW_LIGHT_THRESHOLD
            frame_idx += 1

            now = time.perf_counter()
            if last_out is not None:
                fps = fps * 0.85 + (1 / max(1e-3, now - last_out)) * 0.15 if fps else 1 / max(1e-3, now - last_out)
            last_out = now

            # Normalized + mirrored (x -> 1 - x), matching the old browser worker's output.
            self.publish({
                'type': 'landmarks',
                'hands': [[[round(1 - float(p[0]) / W, 5), round(float(p[1]) / H, 5), round(float(p[2]), 5)] for p in hand] for hand in hands],
                'pose': None if pose is None else [[round(1 - float(p[0]) / W, 5), round(float(p[1]) / H, 5), round(float(p[2]), 5), round(float(p[3]), 4)] for p in pose],
                'inferenceMs': round(inference_ms, 2),
                'isLowLight': low_light,
                'fps': round(fps, 1),
                'mode': mode,
            })

            if video_fps:  # pace video files like a live camera (a real camera paces itself in cap.read)
                now = time.perf_counter()
                next_due = max(next_due + 1 / video_fps, now - 1 / video_fps)
                if next_due > now:
                    time.sleep(next_due - now)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=3101)
    ap.add_argument('--source', default='0', help='camera index, camera name (e.g. FaceTime), or video file')
    ap.add_argument('--loop', action='store_true', help='loop a video file source')
    args = ap.parse_args()
    source = int(args.source) if args.source.isdigit() else args.source

    clients = set()
    aloop = asyncio.get_running_loop()

    def publish(msg):
        try:
            data = json.dumps(msg, separators=(',', ':'))
        except (TypeError, ValueError) as err:
            print(f'[vision] dropped unserializable message: {err}', flush=True)
            return
        aloop.call_soon_threadsafe(lambda: broadcast(clients, data))

    vision = VisionLoop(source, args.loop, publish)

    def check_origin(connection, request):
        if not allowed_origin(request.headers.get('Origin')):
            return connection.respond(403, 'origin not allowed\n')
        return None

    async def handler(ws):
        clients.add(ws)
        try:
            await ws.send(json.dumps(vision.status))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if msg.get('type') == 'set_mode' and msg.get('mode') in MODES:
                    vision.mode = msg['mode']
        finally:
            clients.discard(ws)

    async with serve(handler, '127.0.0.1', args.port, process_request=check_origin, compression=None):
        print(f'[vision] listening on ws://127.0.0.1:{args.port}', flush=True)
        vision.start()
        await asyncio.Future()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
