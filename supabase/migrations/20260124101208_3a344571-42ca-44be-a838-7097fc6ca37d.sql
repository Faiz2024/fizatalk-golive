-- Create bot_settings table for storing dynamic bot configurations
CREATE TABLE IF NOT EXISTS public.bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by BIGINT
);

-- Enable RLS
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy - Service role only (bot internal use)
CREATE POLICY "Service role has full access to bot_settings"
  ON public.bot_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bot_settings_key ON public.bot_settings(key);

-- Insert default values (optional - can be updated by admin commands)
INSERT INTO public.bot_settings (key, value) VALUES
  ('qris_file_id', ''),
  ('premium_file_id', ''),
  ('promo_premium_file_id', '')
ON CONFLICT (key) DO NOTHING;