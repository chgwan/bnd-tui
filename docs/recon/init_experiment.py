#!/usr/bin/env python3
"""Decisive experiment: can the official kernel global_init run headless (no X)?

Isolated HOME so the real ~/.config/baidunetdisk (GUI's state) is never touched.
"""
import ctypes, os, sys, time

ENGINE = os.path.expanduser('~/opt/baidunetdisk/opt/baidunetdisk/libbrowserengine.so')

InternalLogCb = ctypes.CFUNCTYPE(None, ctypes.c_uint32, ctypes.c_char_p)
CommonEventCb = ctypes.CFUNCTYPE(None, ctypes.c_int32, ctypes.c_char_p, ctypes.c_int32)
ExitFinishedCb = ctypes.CFUNCTYPE(None, ctypes.c_bool)

events = []

@InternalLogCb
def on_log(level, msg):
    try:
        line = msg.decode('utf-8', 'replace') if msg else ''
    except Exception:
        line = repr(msg)
    print(f'[kernel-log {level}] {line[:200]}', flush=True)

@CommonEventCb
def on_event(eid, payload, extra):
    body = payload.decode('utf-8', 'replace') if payload else ''
    events.append((eid, body[:400], extra))
    print(f'[event id={eid} extra={extra}] {body[:400]}', flush=True)

@ExitFinishedCb
def on_exit(ok):
    print(f'[exit-finished ok={ok}]', flush=True)

def main():
    workdir = os.environ.get('BND_TEST_WORKDIR', os.path.expanduser('~'))
    print(f'HOME={os.environ.get("HOME")} DISPLAY={os.environ.get("DISPLAY","<unset>")} workdir={workdir}', flush=True)
    lib = ctypes.CDLL(ENGINE)
    lib.browser_engine_get_version.restype = ctypes.c_char_p
    lib.browser_engine_global_init.argtypes = [InternalLogCb, CommonEventCb, ctypes.c_char_p]
    lib.browser_engine_global_uninit.argtypes = [ExitFinishedCb]

    print('version:', lib.browser_engine_get_version().decode(), flush=True)

    t0 = time.time()
    rc = lib.browser_engine_global_init(on_log, on_event, workdir.encode())
    dt = time.time() - t0
    print(f'global_init rc={rc} in {dt:.2f}s', flush=True)

    # give kernel threads a moment to breathe / fire events
    time.sleep(3)
    print(f'events after 3s: {len(events)}', flush=True)

    if rc == 0:
        t1 = time.time()
        lib.browser_engine_global_uninit(on_exit)
        print(f'global_uninit called, took {time.time()-t1:.2f}s', flush=True)
        time.sleep(2)
    print('EXPERIMENT DONE rc=%d init_time=%.2f' % (rc, dt), flush=True)

if __name__ == '__main__':
    main()
