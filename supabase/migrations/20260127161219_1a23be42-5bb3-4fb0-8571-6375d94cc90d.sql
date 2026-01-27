-- Create table for blocked users
CREATE TABLE public.blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  reason TEXT NOT NULL,
  blocked_message TEXT,
  blocked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  unblocked_at TIMESTAMP WITH TIME ZONE,
  unblocked_by BIGINT,
  is_active BOOLEAN DEFAULT true
);

-- Create table for spam detection tracking
CREATE TABLE public.spam_detection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  message_hash TEXT NOT NULL,
  message_preview TEXT,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  detection_type TEXT NOT NULL -- 'username_tag', 'copy_paste', 'repeated_message'
);

-- Create index for faster lookups
CREATE INDEX idx_blocked_users_user_id ON public.blocked_users(user_id);
CREATE INDEX idx_blocked_users_active ON public.blocked_users(is_active);
CREATE INDEX idx_spam_detection_user_id ON public.spam_detection(user_id);
CREATE INDEX idx_spam_detection_hash ON public.spam_detection(message_hash);

-- Enable RLS
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spam_detection ENABLE ROW LEVEL SECURITY;

-- Create policy for service role access
CREATE POLICY "Service role can manage blocked_users"
ON public.blocked_users
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage spam_detection"
ON public.spam_detection
FOR ALL
USING (true)
WITH CHECK (true);