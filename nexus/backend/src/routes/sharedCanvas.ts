/**
 * /api/shared-canvas — Real-time collaborative drawing canvas.
 *
 * Routes:
 *   GET    /:connectionId          → current canvas state (snapshot URL + meta)
 *   POST   /:connectionId/stroke   → broadcast stroke to partner (ephemeral, no DB)
 *   POST   /:connectionId/snapshot → save canvas PNG to storage, update DB
 *   DELETE /:connectionId          → clear canvas (storage + DB + SSE)
 *   POST   /:connectionId/save-to-photo-frame → copy snapshot → shared-photos
 *
 * Storage bucket: "shared-canvas" (public).
 * One file per connection: shared-canvas/{connectionId}/canvas.png (upserted).
 * Backend uses service-role key → bypasses bucket RLS.
 * All access control is via assertParticipant().
 */
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToConnection } from '../lib/sseRegistry.js';

export const sharedCanvasRouter = Router();

const CANVAS_BUCKET = 'shared-canvas';
const PHOTO_BUCKET  = 'shared-photos';

// ── Multer — in-memory storage, 15 MB limit, images only ────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Ensure the canvas bucket exists on startup
(async () => {
  try {
    await supabase.storage.createBucket(CANVAS_BUCKET, {
      public: true,
      allowedMimeTypes: ['image/*'],
      fileSizeLimit: 15 * 1024 * 1024,
    });
  } catch {
    // Already exists — not an error
  }
})();

// ── Participant cache (reduces DB hits on high-frequency stroke route) ───────
const _participantCache = new Map<string, Set<string>>();

async function assertParticipant(connectionId: string, userId: string): Promise<boolean> {
  const cached = _participantCache.get(connectionId);
  if (cached) return cached.has(userId);

  const { data } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();

  if (!data) return false;

  const participants = new Set([data.user_id_a, data.user_id_b]);
  _participantCache.set(connectionId, participants);
  return participants.has(userId);
}

// ── GET /:connectionId ───────────────────────────────────────────────────────

sharedCanvasRouter.get('/:connectionId', requireAuth, async (req: AuthRequest, res) => {
  const { connectionId } = req.params;
  const userId = req.user!.id;

  if (!(await assertParticipant(connectionId, userId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data, error } = await supabase
    .from('shared_canvas')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return res.json({ empty: true });
    return res.status(500).json({ error: error.message });
  }

  return res.json({
    snapshotUrl:  data.snapshot_url,
    lastDrawnBy:  data.last_drawn_by,
    lastDrawnAt:  data.last_drawn_at,
    version:      data.version,
  });
});

// ── POST /:connectionId/stroke ───────────────────────────────────────────────
// Ephemeral: validate, broadcast, return. No DB write.

sharedCanvasRouter.post('/:connectionId/stroke', requireAuth, async (req: AuthRequest, res) => {
  const { connectionId } = req.params;
  const userId = req.user!.id;

  if (!(await assertParticipant(connectionId, userId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const stroke = req.body;
  if (!stroke || !Array.isArray(stroke.points)) {
    return res.status(400).json({ error: 'Invalid stroke payload' });
  }

  await broadcastToConnection(connectionId, {
    type:        'canvas:stroke',
    connectionId,
    widgetType:  'shared_canvas',
    payload:     { ...stroke, userId },
    sentBy:      userId,
    timestamp:   new Date().toISOString(),
  });

  return res.json({ ok: true });
});

// ── POST /:connectionId/snapshot ─────────────────────────────────────────────

sharedCanvasRouter.post(
  '/:connectionId/snapshot',
  requireAuth,
  upload.single('snapshot'),
  async (req: AuthRequest, res) => {
    const { connectionId } = req.params;
    const userId = req.user!.id;

    if (!(await assertParticipant(connectionId, userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No snapshot file provided' });
    }

    // Always upsert to the same path — one file per connection, ever
    const storagePath = `${connectionId}/canvas.png`;

    const { error: uploadError } = await supabase.storage
      .from(CANVAS_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      return res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
    }

    const { data: { publicUrl } } = supabase.storage
      .from(CANVAS_BUCKET)
      .getPublicUrl(storagePath);

    const now = new Date().toISOString();

    // Upsert DB row, incrementing version
    const { data: existing } = await supabase
      .from('shared_canvas')
      .select('version')
      .eq('connection_id', connectionId)
      .single();

    const newVersion = (existing?.version ?? 0) + 1;

    const { error: dbError } = await supabase
      .from('shared_canvas')
      .upsert({
        connection_id:  connectionId,
        snapshot_url:   publicUrl,
        snapshot_path:  storagePath,
        last_drawn_by:  userId,
        last_drawn_at:  now,
        version:        newVersion,
      }, { onConflict: 'connection_id' });

    if (dbError) {
      return res.status(500).json({ error: `DB upsert failed: ${dbError.message}` });
    }

    await broadcastToConnection(connectionId, {
      type:        'canvas:snapshot_saved',
      connectionId,
      widgetType:  'shared_canvas',
      payload:     { snapshotUrl: publicUrl, version: newVersion },
      sentBy:      userId,
      timestamp:   now,
    });

    return res.json({ snapshotUrl: publicUrl, version: newVersion });
  },
);

// ── DELETE /:connectionId ────────────────────────────────────────────────────

sharedCanvasRouter.delete('/:connectionId', requireAuth, async (req: AuthRequest, res) => {
  const { connectionId } = req.params;
  const userId = req.user!.id;

  if (!(await assertParticipant(connectionId, userId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Remove storage file
  await supabase.storage
    .from(CANVAS_BUCKET)
    .remove([`${connectionId}/canvas.png`]);

  await supabase.from('shared_canvas').delete().eq('connection_id', connectionId);

  const now = new Date().toISOString();

  await broadcastToConnection(connectionId, {
    type:        'canvas:cleared',
    connectionId,
    widgetType:  'shared_canvas',
    payload:     {},
    sentBy:      userId,
    timestamp:   now,
  });

  return res.json({ success: true });
});

// ── POST /:connectionId/save-to-photo-frame ──────────────────────────────────
// Copies the current canvas snapshot into the shared-photos bucket and upserts
// the shared_photos table so the Photo Frame widget shows the drawing.

sharedCanvasRouter.post('/:connectionId/save-to-photo-frame', requireAuth, async (req: AuthRequest, res) => {
  const { connectionId } = req.params;
  const userId = req.user!.id;

  if (!(await assertParticipant(connectionId, userId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Fetch current canvas record
  const { data: canvasRow } = await supabase
    .from('shared_canvas')
    .select('snapshot_url, snapshot_path')
    .eq('connection_id', connectionId)
    .single();

  if (!canvasRow?.snapshot_url) {
    return res.status(404).json({ error: 'No canvas snapshot exists yet' });
  }

  // Download the canvas PNG from storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from(CANVAS_BUCKET)
    .download(`${connectionId}/canvas.png`);

  if (downloadError || !fileData) {
    return res.status(500).json({ error: 'Failed to download canvas snapshot' });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  // Resolve uploader profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', userId)
    .single();

  // Fetch existing photo record so we can delete the old file
  const { data: existingPhoto } = await supabase
    .from('shared_photos')
    .select('photo_path')
    .eq('connection_id', connectionId)
    .single();

  // Build a unique path in shared-photos bucket
  const randomId = Math.random().toString(36).slice(2, 12);
  const newPhotoPath = `${connectionId}/${Date.now()}-${randomId}.png`;

  // Ensure shared-photos bucket exists
  try {
    await supabase.storage.createBucket(PHOTO_BUCKET, {
      public: true,
      allowedMimeTypes: ['image/*'],
      fileSizeLimit: 10 * 1024 * 1024,
    });
  } catch { /* already exists */ }

  // Upload to shared-photos bucket
  const { error: photoUploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(newPhotoPath, buffer, { contentType: 'image/png', upsert: false });

  if (photoUploadError) {
    return res.status(500).json({ error: `Photo upload failed: ${photoUploadError.message}` });
  }

  // Delete old photo file if exists
  if (existingPhoto?.photo_path) {
    await supabase.storage.from(PHOTO_BUCKET).remove([existingPhoto.photo_path]);
  }

  const { data: { publicUrl: photoUrl } } = supabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(newPhotoPath);

  const now = new Date().toISOString();

  const { error: dbError } = await supabase
    .from('shared_photos')
    .upsert({
      connection_id:         connectionId,
      photo_url:             photoUrl,
      photo_path:            newPhotoPath,
      uploaded_by:           userId,
      uploader_username:     profile?.username     ?? null,
      uploader_display_name: profile?.display_name ?? null,
      uploaded_at:           now,
    }, { onConflict: 'connection_id' });

  if (dbError) {
    return res.status(500).json({ error: `DB upsert failed: ${dbError.message}` });
  }

  const photoPayload = {
    photoUrl,
    uploadedBy:          userId,
    uploadedAt:          now,
    uploaderUsername:    profile?.username     ?? null,
    uploaderDisplayName: profile?.display_name ?? null,
  };

  await broadcastToConnection(connectionId, {
    type:        'photo:updated',
    connectionId,
    widgetType:  'shared_photo',
    payload:     photoPayload,
    sentBy:      userId,
    timestamp:   now,
  });

  return res.json({ success: true, photoUrl });
});
