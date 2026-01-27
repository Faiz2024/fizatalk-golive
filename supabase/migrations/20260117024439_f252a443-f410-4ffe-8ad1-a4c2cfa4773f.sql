-- Drop chat_pairs table (tidak digunakan lagi untuk menghemat database)
DROP TABLE IF EXISTS public.chat_pairs;

-- Create promo_queue table for /promo command
CREATE TABLE IF NOT EXISTS public.promo_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id bigint NOT NULL,
  message_text text NOT NULL,
  photo_url text,
  promo_buttons jsonb,
  status text NOT NULL DEFAULT 'pending',
  sent_message_id integer,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.promo_queue ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for service role
CREATE POLICY "Service role has full access to promo_queue" 
ON public.promo_queue 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_promo_queue_status ON public.promo_queue(status);
CREATE INDEX idx_promo_queue_user_id ON public.promo_queue(user_id);
CREATE INDEX idx_promo_queue_expires_at ON public.promo_queue(expires_at);