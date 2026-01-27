-- Add location fields to telegram_users table for location filtering
ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS location TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS target_location TEXT DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.telegram_users.location IS 'User location (province/city)';
COMMENT ON COLUMN public.telegram_users.target_location IS 'Target location preference for matching';