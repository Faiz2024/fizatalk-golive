-- Add gender and target_gender columns to telegram_users
ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS gender text,
ADD COLUMN IF NOT EXISTS target_gender text;