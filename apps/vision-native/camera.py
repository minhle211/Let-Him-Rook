"""
Native macOS camera capture (AVFoundation via PyObjC).

OpenCV's AVFoundation backend returns all-black frames on recent macOS (verified on macOS 26 with
OpenCV 4.11 and 5.0 while AVFoundation itself delivers real frames), so capture talks to
AVFoundation directly: 640x480 BGRA frames, newest frame only, camera selected by name.
"""
import threading

import AVFoundation as AV
import CoreMedia
import numpy as np
import objc
import Quartz
from Foundation import NSObject
import libdispatch


def list_cameras():
    return list(AV.AVCaptureDevice.devicesWithMediaType_(AV.AVMediaTypeVideo))


def pick_camera(selector=None):
    """selector: None (prefer the built-in camera), an index, or a name substring like 'FaceTime'."""
    devices = list_cameras()
    if not devices:
        return None
    if selector is None:
        built_in = [d for d in devices if d.deviceType() == AV.AVCaptureDeviceTypeBuiltInWideAngleCamera]
        return (built_in or devices)[0]
    if isinstance(selector, int):
        return devices[selector] if 0 <= selector < len(devices) else None
    return next((d for d in devices if selector.lower() in str(d.localizedName()).lower()), None)


def authorization_status():
    """'authorized' | 'denied' | 'restricted' | 'notDetermined' for the app that launched us (e.g. Terminal/VS Code)."""
    s = AV.AVCaptureDevice.authorizationStatusForMediaType_(AV.AVMediaTypeVideo)
    return {0: 'notDetermined', 1: 'restricted', 2: 'denied', 3: 'authorized'}.get(s, str(s))


def request_access(timeout=120):
    done = threading.Event()
    result = {}

    def handler(granted):
        result['granted'] = bool(granted)
        done.set()

    AV.AVCaptureDevice.requestAccessForMediaType_completionHandler_(AV.AVMediaTypeVideo, handler)
    done.wait(timeout)
    return result.get('granted', False)


class _FrameDelegate(NSObject):
    def initWithSink_(self, sink):
        self = objc.super(_FrameDelegate, self).init()
        if self is None:
            return None
        self.sink = sink
        return self

    def captureOutput_didOutputSampleBuffer_fromConnection_(self, output, sample_buffer, connection):
        pb = CoreMedia.CMSampleBufferGetImageBuffer(sample_buffer)
        if pb is None:
            return
        Quartz.CVPixelBufferLockBaseAddress(pb, Quartz.kCVPixelBufferLock_ReadOnly)
        try:
            w, h = Quartz.CVPixelBufferGetWidth(pb), Quartz.CVPixelBufferGetHeight(pb)
            stride = Quartz.CVPixelBufferGetBytesPerRow(pb)
            raw = Quartz.CVPixelBufferGetBaseAddress(pb).as_buffer(stride * h)
            bgra = np.frombuffer(raw, np.uint8).reshape(h, stride)[:, :w * 4].reshape(h, w, 4).copy()
        finally:
            Quartz.CVPixelBufferUnlockBaseAddress(pb, Quartz.kCVPixelBufferLock_ReadOnly)
        self.sink(bgra)


class MacCamera:
    """Delivers the newest RGB frame; read() blocks until a frame newer than the last one arrives."""

    def __init__(self, selector=None, width=640, height=480):
        self.device = pick_camera(selector)
        if self.device is None:
            raise RuntimeError(f'No camera matching {selector!r} (found: {[str(d.localizedName()) for d in list_cameras()]})')
        self.name = str(self.device.localizedName())
        self._cond = threading.Condition()
        self._frame, self._seq, self._read_seq = None, 0, 0

        self.session = AV.AVCaptureSession.alloc().init()
        inp, err = AV.AVCaptureDeviceInput.deviceInputWithDevice_error_(self.device, None)
        if inp is None:
            raise RuntimeError(f'Cannot open camera {self.name}: {err}')
        self.session.beginConfiguration()
        self.session.addInput_(inp)

        self.output = AV.AVCaptureVideoDataOutput.alloc().init()
        self.output.setVideoSettings_({Quartz.kCVPixelBufferPixelFormatTypeKey: Quartz.kCVPixelFormatType_32BGRA})
        self.output.setAlwaysDiscardsLateVideoFrames_(True)
        self._delegate = _FrameDelegate.alloc().initWithSink_(self._on_frame)
        self._queue = libdispatch.dispatch_queue_create(b'rook.camera', None)
        self.output.setSampleBufferDelegate_queue_(self._delegate, self._queue)
        self.session.addOutput_(self.output)
        self.session.commitConfiguration()
        self.session.startRunning()
        # 640x480 (4:3) to match the browser's preview stream, so normalized landmarks line up with it.
        # Must be set on the device after the session starts; presets are overridden when another app
        # (the browser preview) already holds the camera at a different format.
        self._set_active_format(width, height)

    def _set_active_format(self, width, height):
        match = None
        for fmt in self.device.formats():
            dims = CoreMedia.CMVideoFormatDescriptionGetDimensions(fmt.formatDescription())
            if (dims.width, dims.height) == (width, height):
                match = fmt
                break
        if match is None:
            return  # keep the device default
        ok, err = self.device.lockForConfiguration_(None)
        if ok:
            self.device.setActiveFormat_(match)
            self.device.unlockForConfiguration()

    def _on_frame(self, bgra):
        with self._cond:
            self._frame = bgra
            self._seq += 1
            self._cond.notify_all()

    def read(self, timeout=2.0):
        """Returns (ok, rgb)."""
        with self._cond:
            if not self._cond.wait_for(lambda: self._seq > self._read_seq, timeout):
                return False, None
            self._read_seq = self._seq
            bgra = self._frame
        return True, np.ascontiguousarray(bgra[:, :, 2::-1])  # BGRA -> RGB

    def release(self):
        self.session.stopRunning()
