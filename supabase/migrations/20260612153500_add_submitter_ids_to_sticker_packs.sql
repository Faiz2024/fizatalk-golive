-- Migration: Add submitter_ids array to sticker_packs to track unique users submitting a pack
-- =============================================================================

ALTER TABLE public.sticker_packs 
ADD COLUMN IF NOT EXISTS submitter_ids BIGINT[] DEFAULT '{}'::BIGINT[];

-- Inisialisasi data lama dengan requester_id jika ada
UPDATE public.sticker_packs 
SET submitter_ids = ARRAY[requester_id] 
WHERE submitter_ids = '{}'::BIGINT[] AND requester_id IS NOT NULL;
