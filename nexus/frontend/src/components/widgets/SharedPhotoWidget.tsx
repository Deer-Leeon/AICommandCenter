/**
 * SharedPhotoWidget — real-time shared single-photo frame between two friends.
 *
 * States:
 *   display  — shows the current photo (or empty state)
 *   camera   — live camera feed, shutter button to capture
 *   preview  — still preview of captured/selected image, confirm/retake controls
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useConnections } from '../../hooks/useConnections';
import { useSharedChannel } from '../../hooks/useSharedChannel';
import { apiFetch, apiFetchMultipart } from '../../lib/api';
import { nexusSSE } from '../../lib/nexusSSE';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhotoRecord {
  photoUrl:            string;
  uploadedBy:          string;
  uploadedAt:          string;
  uploaderUsername:    string | null;
  uploaderDisplayName: string | null;
}

type WidgetState = 'display' | 'camera' | 'preview';
type LayoutMode  = 'micro' | 'slim' | 'standard' | 'expanded';

interface Props {
  connectionId: string;
  slotKey:      string;
  onClose:      () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getLayoutMode(w: number, h: number): LayoutMode {
  if (w < 200 && h < 200) return 'micro';
  if (w < 260 || h < 260) return 'slim';
  if (w >= 400 && h >= 400) return 'expanded';
  return 'standard';
}

// ── CSS (injected once) ───────────────────────────────────────────────────────

const STYLES = `
@keyframes sp-fadein  { from { opacity: 0 } to { opacity: 1 } }
@keyframes sp-scaleup { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: scale(1) } }
@keyframes sp-pulse   { 0%,100% { box-shadow: 0 0 0 3px rgba(255,255,255,0.25) } 50% { box-shadow: 0 0 0 9px rgba(255,255,255,0.08) } }
@keyframes sp-toast   { 0% { opacity: 0; transform: translateY(-8px) } 15%,80% { opacity: 1; transform: translateY(0) } 100% { opacity: 0; transform: translateY(-8px) } }
@keyframes sp-progress { 0% { width: 0% } 85% { width: 92% } 100% { width: 96% } }

.sp-widget { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: inherit; background: var(--surface); }

.sp-photo-layer {
  position: absolute; inset: 0;
  background-size: cover; background-position: center; background-repeat: no-repeat;
  transition: opacity 0.3s ease;
}

.sp-hover-overlay {
  position: absolute; inset: 0;
  opacity: 0; transition: opacity 0.15s ease;
  pointer-events: none;
}
.sp-widget:hover .sp-hover-overlay { opacity: 1; pointer-events: auto; }

.sp-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border-radius: 20px;
  font-size: 12px; color: #fff; white-space: nowrap;
}

.sp-frosted-bar {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 64px;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; align-items: center; justify-content: space-between; padding: 0 16px;
}
.sp-frosted-bar.compact { height: 52px; padding: 0 12px; }

.sp-shutter {
  width: 56px; height: 56px; border-radius: 50%;
  background: #fff; border: none;
  cursor: pointer; flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(255,255,255,0.25);
  animation: sp-pulse 1.5s ease-in-out infinite;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.1s ease;
  font-size: 18px;
}
.sp-shutter:active { transform: scale(0.92); }
.sp-shutter.compact { width: 44px; height: 44px; font-size: 15px; }

.sp-icon-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(255,255,255,0.15); backdrop-filter: blur(8px);
  border: none; color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; transition: background 0.15s;
  flex-shrink: 0;
}
.sp-icon-btn:hover { background: rgba(255,255,255,0.25); }

.sp-ctrl-btn {
  padding: 7px 16px; border-radius: 20px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: opacity 0.15s;
}
.sp-ctrl-btn.primary {
  background: var(--accent); color: #000; border: none;
  box-shadow: 0 0 12px rgba(124,106,255,0.4);
}
.sp-ctrl-btn.secondary {
  background: transparent; color: #fff;
  border: 1px solid rgba(255,255,255,0.5);
}
.sp-ctrl-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sp-toast {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  pointer-events: none; z-index: 20;
  animation: sp-toast 3.5s ease forwards;
}

.sp-progress-bar {
  position: absolute; top: 0; left: 0; height: 2px;
  background: var(--accent);
  animation: sp-progress 8s ease forwards;
}

video.sp-video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover;
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export function SharedPhotoWidget({ connectionId, slotKey, onClose }: Props) {
  const { user } = useAuth();
  const { active: connections } = useConnections(true);

  // ── State ──────────────────────────────────────────────────────────────────
  const [widgetState, setWidgetState]       = useState<WidgetState>('display');
  const [photo, setPhoto]                   = useState<PhotoRecord | null>(null);
  const [prevPhotoUrl, setPrevPhotoUrl]     = useState<string | null>(null);  // for dissolve
  const [photoVisible, setPhotoVisible]     = useState(true);
  const [dissolved, setDissolved]           = useState(false);
  const [mode, setMode]                     = useState<LayoutMode>('standard');

  // Camera
  const [stream, setStream]                 = useState<MediaStream | null>(null);
  const [cameras, setCameras]               = useState<MediaDeviceInfo[]>([]);
  const [camIndex, setCamIndex]             = useState(0);
  const [cameraError, setCameraError]       = useState<string | null>(null);
  const [cameraLabel, setCameraLabel]       = useState<string>('');

  // Preview / upload
  const [capturedBlob, setCapturedBlob]     = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl]       = useState<string | null>(null);  // object URL
  const [isUploading, setIsUploading]       = useState(false);
  const [uploadError, setUploadError]       = useState<string | null>(null);

  // Toast
  const [toast, setToast]                   = useState<string | null>(null);
  const [toastKey, setToastKey]             = useState(0);

  // Time display
  const [, forceRender]                     = useState(0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);  // always-fresh ref for cleanup
  const dissolveTimer = useRef<ReturnType<typeof setTimeout>>();
  const timeTimer     = useRef<ReturnType<typeof setInterval>>();

  // ── Partner info ───────────────────────────────────────────────────────────
  const partner = connections.find((c) => c.connection_id === connectionId)?.partner;
  const partnerName = partner?.displayName ?? 'your friend';
  const partnerUsername = partner?.username ?? '';
  const partnerOnline = connections.find((c) => c.connection_id === connectionId)?.presence?.isOnline ?? false;

  // ── Inject styles ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('sp-styles')) return;
    const el = document.createElement('style');
    el.id = 'sp-styles';
    el.textContent = STYLES;
    document.head.appendChild(el);
  }, []);

  // ── ResizeObserver ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setMode(getLayoutMode(width, height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Tick "X min ago" every 30s ─────────────────────────────────────────────
  useEffect(() => {
    timeTimer.current = setInterval(() => forceRender((n) => n + 1), 30_000);
    return () => clearInterval(timeTimer.current);
  }, []);

  // ── SSE: connection dissolved ──────────────────────────────────────────────
  useEffect(() => {
    return nexusSSE.subscribe((ev) => {
      const e = ev as { type: string; connectionId?: string };
      if (e.type === 'connection:dissolved' && e.connectionId === connectionId) {
        setDissolved(true);
      }
    });
  }, [connectionId]);

  // ── SSE: photo events (via useSharedChannel) ───────────────────────────────
  const handleSSE = useCallback((evt: { type: string; payload: unknown }) => {
    if (evt.type === 'photo:updated') {
      const p = evt.payload as PhotoRecord;
      if (p.uploadedBy !== user?.id) {
        // Incoming from partner → dissolve animation
        dissolve(p);
        const uploaderLabel = p.uploaderDisplayName
          ? `📷 ${p.uploaderDisplayName} just shared a photo`
          : '📷 New photo shared';
        showToast(uploaderLabel);
      }
    }
    if (evt.type === 'photo:cleared') {
      dissolveOut();
    }
  }, [user?.id]); // eslint-disable-line

  useSharedChannel(connectionId, 'shared_photo', handleSSE);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!connectionId) return;
    apiFetch(`/api/shared-photo/${connectionId}`)
      .then(async (r) => {
        if (r.status === 403) { setDissolved(true); return; }
        const d = await r.json();
        if (d.empty) return;
        setPhoto(d as PhotoRecord);
        setPhotoVisible(true);
      })
      .catch(() => { /* silent */ });
  }, [connectionId]);

  // ── Cleanup object URLs ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
  }, [capturedUrl]);

  // ── Dissolve helpers ───────────────────────────────────────────────────────
  function dissolve(newPhoto: PhotoRecord) {
    clearTimeout(dissolveTimer.current);
    setPrevPhotoUrl(photo?.photoUrl ?? null);
    setPhotoVisible(false);
    dissolveTimer.current = setTimeout(() => {
      setPhoto(newPhoto);
      setPhotoVisible(true);
      setPrevPhotoUrl(null);
    }, 300);
  }

  function dissolveOut() {
    clearTimeout(dissolveTimer.current);
    setPhotoVisible(false);
    dissolveTimer.current = setTimeout(() => {
      setPhoto(null);
      setPhotoVisible(true);
    }, 300);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(text: string) {
    setToast(text);
    setToastKey((k) => k + 1);
    setTimeout(() => setToast(null), 3600);
  }

  // ── Attach stream to video element once camera state renders it ───────────
  // startCamera() calls setWidgetState('camera') last, so the <video> element
  // doesn't exist yet when we have the stream.  This effect fires after the
  // DOM updates and safely wires the stream to the newly-mounted video element.
  useEffect(() => {
    if (widgetState !== 'camera' || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => { /* ignore autoplay policy */ });
  }, [widgetState, stream]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  async function startCamera(deviceId?: string) {
    try {
      stopStream();
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = s;
      setStream(s);

      // Enumerate cameras (only once)
      if (cameras.length === 0) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vids = devices.filter((d) => d.kind === 'videoinput');
        setCameras(vids);
      }

      const track = s.getVideoTracks()[0];
      setCameraLabel(track?.label || 'Camera');
      setCameraError(null);
      setWidgetState('camera'); // <video> mounts after this; useEffect above attaches stream
    } catch {
      setCameraError('Camera access denied — use Upload instead');
      setWidgetState('camera');
    }
  }

  async function flipCamera() {
    const nextIdx = (camIndex + 1) % cameras.length;
    setCamIndex(nextIdx);
    await startCamera(cameras[nextIdx]?.deviceId);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }

  function exitCamera() {
    stopStream();
    setWidgetState('display');
    setCameraError(null);
  }

  // ── Capture ────────────────────────────────────────────────────────────────
  function capturePhoto() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      stopStream();
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      setCapturedBlob(blob);
      setCapturedUrl(URL.createObjectURL(blob));
      setWidgetState('preview');
    }, 'image/jpeg', 0.92);
  }

  // ── File picker ────────────────────────────────────────────────────────────
  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(file);
    setCapturedUrl(URL.createObjectURL(file));
    setWidgetState('preview');
    // Reset so the same file can be re-selected
    e.target.value = '';
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function uploadPhoto() {
    if (!capturedBlob) return;
    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append(
        'photo',
        capturedBlob instanceof File
          ? capturedBlob
          : new File([capturedBlob], 'photo.jpg', { type: 'image/jpeg' }),
      );

      const res = await apiFetchMultipart(`/api/shared-photo/${connectionId}/upload`, formData);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' })) as { error?: string };
        throw new Error(err.error ?? 'Upload failed');
      }

      const newPhoto = await res.json() as PhotoRecord;

      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      setCapturedBlob(null);
      setCapturedUrl(null);

      // Dissolve in the new photo
      dissolve(newPhoto);
      setWidgetState('display');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed — try again');
    } finally {
      setIsUploading(false);
    }
  }

  function retake() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setUploadError(null);
    startCamera();
  }

  function cancelPreview() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setUploadError(null);
    stopStream();
    setWidgetState('display');
  }

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(dissolveTimer.current);
      clearInterval(timeTimer.current);
      stopStream();
    };
  }, []); // eslint-disable-line

  // ── Dissolved state ────────────────────────────────────────────────────────
  if (dissolved) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: 20, textAlign: 'center',
      }}>
        <span style={{ fontSize: 32 }}>🔗</span>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          Photo frame unavailable
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This connection has ended.
        </p>
        <button
          onClick={onClose}
          style={{
            marginTop: 4, padding: '8px 16px',
            background: 'var(--surface2)', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 12, cursor: 'pointer',
          }}
        >
          Remove widget
        </button>
      </div>
    );
  }

  const isCompact = mode === 'micro' || mode === 'slim';

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="sp-widget" key={slotKey}>
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* ── DISPLAY STATE ──────────────────────────────────────────────────── */}
      {widgetState === 'display' && (
        <>
          {/* Previous photo layer (fades out during dissolve) */}
          {prevPhotoUrl && (
            <div
              className="sp-photo-layer"
              style={{ backgroundImage: `url(${prevPhotoUrl})`, opacity: 0, zIndex: 1 }}
            />
          )}

          {/* Current photo layer */}
          {photo ? (
            <div
              className="sp-photo-layer"
              style={{
                backgroundImage: `url(${photo.photoUrl})`,
                opacity: photoVisible ? 1 : 0,
                zIndex: 2,
              }}
            />
          ) : (
            /* Empty state */
            <div style={{
              position: 'absolute', inset: 0, zIndex: 2,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: mode === 'micro' ? 6 : 12,
              border: '1px dashed var(--border)',
              borderRadius: 'inherit',
              padding: 12,
            }}>
              {mode !== 'micro' && (
                <span style={{ fontSize: mode === 'expanded' ? 36 : 28 }}>📷</span>
              )}
              {mode !== 'micro' && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No photo yet
                </p>
              )}
              {mode !== 'micro' && (
                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>
                  Shared with {partnerUsername ? `@${partnerUsername}` : partnerName}
                </p>
              )}
              {mode === 'micro' ? (
                /* Micro: single compact upload row */
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sp-icon-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                    onClick={() => startCamera()}>📷</button>
                  <button className="sp-icon-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                    onClick={openFilePicker}>🖼️</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => startCamera()}
                    style={{
                      padding: '7px 14px', background: 'var(--surface2)',
                      color: 'var(--text)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    📷 Take Photo
                  </button>
                  <button
                    onClick={openFilePicker}
                    style={{
                      padding: '7px 14px', background: 'var(--accent)',
                      color: '#000', border: 'none',
                      borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    🖼️ Upload
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Hover overlay (with photo) */}
          {photo && (
            <div className="sp-hover-overlay" style={{ zIndex: 10 }}>
              {/* Top left — uploader info */}
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <div className="sp-pill" style={{ animation: 'sp-fadein 0.15s ease' }}>
                  <span>📷</span>
                  <span>
                    {photo.uploaderDisplayName
                      ? photo.uploaderDisplayName
                      : photo.uploaderUsername
                        ? `@${photo.uploaderUsername}`
                        : 'Someone'}
                  </span>
                </div>
              </div>

              {/* Top right — timestamp */}
              {mode !== 'micro' && (
                <div style={{ position: 'absolute', top: 10, right: 10 }}>
                  <div className="sp-pill">{timeAgo(photo.uploadedAt)}</div>
                </div>
              )}

              {/* Bottom left — partner presence */}
              {mode !== 'micro' && partnerOnline && (
                <div style={{ position: 'absolute', bottom: 72, left: 10 }}>
                  <div className="sp-pill">
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                    {partnerUsername ? `@${partnerUsername}` : partnerName}
                  </div>
                </div>
              )}

              {/* Bottom right — action buttons */}
              <div style={{
                position: 'absolute',
                bottom: isCompact ? 8 : 70,
                right: 10,
                display: 'flex', gap: 6,
              }}>
                <button className="sp-icon-btn" title="Take photo" onClick={() => startCamera()}>📷</button>
                <button className="sp-icon-btn" title="Upload photo" onClick={openFilePicker}>🖼️</button>
              </div>
            </div>
          )}

          {/* New photo toast */}
          {toast && (
            <div className="sp-toast" key={toastKey}>
              <div className="sp-pill" style={{ fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                {toast}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── CAMERA STATE ───────────────────────────────────────────────────── */}
      {widgetState === 'camera' && (
        <>
          {cameraError ? (
            /* Permission denied */
            <div style={{
              position: 'absolute', inset: 0, zIndex: 5,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: 20, textAlign: 'center',
            }}>
              <span style={{ fontSize: 28 }}>🚫</span>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{cameraError}</p>
              <button
                onClick={openFilePicker}
                style={{
                  padding: '8px 16px', background: 'var(--accent)',
                  color: '#000', border: 'none', borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                🖼️ Upload Instead
              </button>
              <button onClick={exitCamera} style={{
                padding: '6px 14px', background: 'transparent',
                color: 'var(--text-muted)', border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 12, cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              {/* Live video */}
              <video
                ref={videoRef}
                className="sp-video"
                autoPlay
                playsInline
                muted
                style={{ zIndex: 3 }}
              />

              {/* Camera label */}
              {mode !== 'micro' && cameraLabel && (
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 6 }}>
                  <div className="sp-pill" style={{ fontSize: 11 }}>{cameraLabel}</div>
                </div>
              )}

              {/* Controls bar */}
              <div className={`sp-frosted-bar${isCompact ? ' compact' : ''}`} style={{ zIndex: 7 }}>
                {/* Exit */}
                <button className="sp-ctrl-btn secondary" onClick={exitCamera}>✕</button>

                {/* Shutter */}
                <button
                  className={`sp-shutter${isCompact ? ' compact' : ''}`}
                  onClick={capturePhoto}
                  disabled={!stream}
                  title="Take photo"
                />

                {/* Flip camera */}
                {cameras.length > 1 ? (
                  <button className="sp-icon-btn" onClick={flipCamera} title="Flip camera">🔄</button>
                ) : (
                  <div style={{ width: 36 }} />
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── PREVIEW STATE ──────────────────────────────────────────────────── */}
      {widgetState === 'preview' && capturedUrl && (
        <>
          {/* Preview image */}
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 3,
              backgroundImage: `url(${capturedUrl})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              animation: 'sp-fadein 0.25s ease',
            }}
          />

          {/* Upload progress bar */}
          {isUploading && (
            <div className="sp-progress-bar" style={{ zIndex: 8 }} />
          )}

          {/* Error toast */}
          {uploadError && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 9 }}>
              <div className="sp-pill" style={{ background: 'rgba(220,38,38,0.85)', fontSize: 12 }}>
                ⚠ {uploadError}
              </div>
            </div>
          )}

          {/* ← Back button (top left) */}
          {mode !== 'micro' && !isUploading && (
            <button
              onClick={cancelPreview}
              style={{
                position: 'absolute', top: 10, left: 10, zIndex: 8,
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
                border: 'none', color: '#fff', borderRadius: 20,
                padding: '5px 12px', fontSize: 12, cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}

          {/* Confirmation bar */}
          <div className={`sp-frosted-bar${isCompact ? ' compact' : ''}`} style={{ zIndex: 7 }}>
            {/* Retake */}
            <button
              className="sp-ctrl-btn secondary"
              onClick={retake}
              disabled={isUploading}
            >
              ✕ {mode === 'micro' ? '' : 'Retake'}
            </button>

            <div style={{ flex: 1 }} />

            {/* Share */}
            <button
              className="sp-ctrl-btn primary"
              onClick={uploadPhoto}
              disabled={isUploading}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {isUploading ? (
                <span style={{ display: 'inline-block', animation: 'sp-pulse 0.8s linear infinite', fontSize: 14 }}>⏳</span>
              ) : (
                <>✓ {mode === 'micro' ? '' : 'Share'}</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
