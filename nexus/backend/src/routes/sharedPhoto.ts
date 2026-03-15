/**
 * /api/shared-photo — Real-time shared single-photo frame between two friends.
 *
 * Only ONE photo ever exists per connection.  Uploading a new photo atomically:
 *   1. Uploads the new file to Supabase Storage
 *   2. Deletes the OLD file from storage
 *   3. Upserts the DB row
 *   4. Broadcasts photo:updated via SSE so both clients update instantly
 *
 * Storage bucket: "shared-photos" (public).  The backend uses the service-role
 * key which bypasses bucket RLS.  All access control is via assertParticipant().
 */
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToConnection } from '../lib/sseRegistry.js';

export const sharedPhotoRouter = Router();

const BUCKET = 'shared-photos';

// ── Multer — memory storage, 10 MB limit, images only ──────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'image/gif',  'image/heic', 'image/heif',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF, HEIC) are allowed'));
    }
  },
});

// Ensure the bucket exists — idempotent, service-role bypasses RLS
(async () => {
  try {
    await supabase.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ['image/*'],
      fileSizeLimit: 10 * 1024 * 1024,
    });
  } catch {
    // Already exists — not an error
  }
})();

// ── Helper ──────────────────────────────────────────────────────────────────

async function assertParticipant(connectionId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();
  if (!data) return false;
  return data.user_id_a === userId || data.user_id_b === userId;
}

// ── GET /:connectionId ───────────────────────────────────────────────────────

sharedPhotoRouter.get('/:connectionId', requireAuth, async (req: AuthRequest, res) => {
  const { connectionId } = req.params;
  const userId = req.user!.id;

  if (!(await assertParticipant(connectionId, userId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data, error } = await supabase
    .from('shared_photos')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return res.json({ empty: true });
    return res.status(500).json({ error: error.message });
  }

  return res.json({
    photoUrl:            data.photo_url,
    photoPath:           data.photo_path,
    uploadedBy:          data.uploaded_by,
    uploadedAt:          data.uploaded_at,
    uploaderUsername:    data.uploader_username,
    uploaderDisplayName: data.uploader_display_name,
  });
});

// ── POST /:connectionId/upload ───────────────────────────────────────────────

sharedPhotoRouter.post(
  '/:connectionId/upload',
  requireAuth,
  upload.single('photo'),
  async (req: AuthRequest, res) => {
    const { connectionId } = req.params;
    const userId = req.user!.id;

    if (!(await assertParticipant(connectionId, userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Resolve uploader profile (username + display name for SSE payload)
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('user_id', userId)
      .single();

    // Fetch existing record so we can delete the old storage file
    const { data: existing } = await supabase
      .from('shared_photos')
      .select('photo_path')
      .eq('connection_id', connectionId)
      .single();

    // Build a unique, unguessable storage path
    const ext = req.file.mimetype === 'image/jpeg' || req.file.mimetype === 'image/jpg'
      ? 'jpg'
      : req.file.mimetype.split('/')[1];
    const randomId = Math.random().toString(36).slice(2, 12);
    const newPath = `${connectionId}/${Date.now()}-${randomId}.${ext}`;

    // Upload new file
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      return res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
    }

    // Delete OLD file immediately — storage must never accumulate
    if (existing?.photo_path) {
      await supabase.storage.from(BUCKET).remove([existing.photo_path]);
    }

    // Build public CDN URL
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(newPath);

    const now = new Date().toISOString();

    // Upsert DB row (connection_id is the PK, so this replaces any existing row)
    const { error: dbError } = await supabase
      .from('shared_photos')
      .upsert({
        connection_id:         connectionId,
        photo_url:             publicUrl,
        photo_path:            newPath,
        uploaded_by:           userId,
        uploader_username:     profile?.username     ?? null,
        uploader_display_name: profile?.display_name ?? null,
        uploaded_at:           now,
      }, { onConflict: 'connection_id' });

    if (dbError) {
      return res.status(500).json({ error: `DB upsert failed: ${dbError.message}` });
    }

    const payload = {
      photoUrl:            publicUrl,
      uploadedBy:          userId,
      uploadedAt:          now,
      uploaderUsername:    profile?.username     ?? null,
      uploaderDisplayName: profile?.display_name ?? null,
    };

    await broadcastToConnection(connectionId, {
      type:       'photo:updated',
      connectionId,
      widgetType: 'shared_photo',
      payload,
      sentBy:     userId,
      timestamp:  now,
    });

    return res.json(payload);
  },
);

// ── DELETE /:connectionId ────────────────────────────────────────────────────

sharedPhotoRouter.delete('/:connectionId', requireAuth, async (req: AuthRequest, res) => {
  const { connectionId } = req.params;
  const userId = req.user!.id;

  if (!(await assertParticipant(connectionId, userId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: existing } = await supabase
    .from('shared_photos')
    .select('photo_path')
    .eq('connection_id', connectionId)
    .single();

  if (existing?.photo_path) {
    await supabase.storage.from(BUCKET).remove([existing.photo_path]);
  }

  await supabase.from('shared_photos').delete().eq('connection_id', connectionId);

  const now = new Date().toISOString();

  await broadcastToConnection(connectionId, {
    type:       'photo:cleared',
    connectionId,
    widgetType: 'shared_photo',
    payload:    {},
    sentBy:     userId,
    timestamp:  now,
  });

  return res.json({ success: true });
});
