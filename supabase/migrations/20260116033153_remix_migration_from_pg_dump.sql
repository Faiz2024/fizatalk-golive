CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: user_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_state AS ENUM (
    'idle',
    'waiting',
    'chatting',
    'awaiting_payment'
);


--
-- Name: cleanup_inactive_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_inactive_users() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM telegram_users 
  WHERE last_active < NOW() - INTERVAL '24 hours' 
    AND state = 'idle';
END;
$$;


SET default_table_access_method = heap;

--
-- Name: chat_pairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_pairs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user1_id bigint NOT NULL,
    user2_id bigint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: coin_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coin_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    amount bigint NOT NULL,
    type text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coin_transactions_type_check CHECK ((type = ANY (ARRAY['topup'::text, 'purchase'::text, 'reward'::text, 'deduction'::text])))
);


--
-- Name: premium_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    duration_days integer NOT NULL,
    price integer NOT NULL,
    unique_code integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payment_proof text,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone
);


--
-- Name: telegram_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_users (
    id bigint NOT NULL,
    username text,
    first_name text,
    state public.user_state DEFAULT 'idle'::public.user_state NOT NULL,
    partner_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active timestamp with time zone DEFAULT now() NOT NULL,
    coins bigint DEFAULT 0 NOT NULL,
    premium_until timestamp with time zone
);


--
-- Name: topup_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topup_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    amount integer NOT NULL,
    unique_code integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payment_proof text,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    CONSTRAINT topup_requests_amount_check CHECK ((amount >= 1000)),
    CONSTRAINT topup_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: user_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    from_user_id bigint NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waiting_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waiting_queue (
    user_id bigint NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_pairs chat_pairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_pairs
    ADD CONSTRAINT chat_pairs_pkey PRIMARY KEY (id);


--
-- Name: chat_pairs chat_pairs_user1_id_user2_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_pairs
    ADD CONSTRAINT chat_pairs_user1_id_user2_id_key UNIQUE (user1_id, user2_id);


--
-- Name: coin_transactions coin_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions
    ADD CONSTRAINT coin_transactions_pkey PRIMARY KEY (id);


--
-- Name: premium_requests premium_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_requests
    ADD CONSTRAINT premium_requests_pkey PRIMARY KEY (id);


--
-- Name: telegram_users telegram_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT telegram_users_pkey PRIMARY KEY (id);


--
-- Name: topup_requests topup_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topup_requests
    ADD CONSTRAINT topup_requests_pkey PRIMARY KEY (id);


--
-- Name: user_reactions user_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reactions
    ADD CONSTRAINT user_reactions_pkey PRIMARY KEY (id);


--
-- Name: waiting_queue waiting_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiting_queue
    ADD CONSTRAINT waiting_queue_pkey PRIMARY KEY (user_id);


--
-- Name: idx_chat_pairs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_pairs_active ON public.chat_pairs USING btree (ended_at) WHERE (ended_at IS NULL);


--
-- Name: idx_coin_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coin_transactions_created_at ON public.coin_transactions USING btree (created_at DESC);


--
-- Name: idx_coin_transactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coin_transactions_user_id ON public.coin_transactions USING btree (user_id);


--
-- Name: idx_premium_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_premium_requests_status ON public.premium_requests USING btree (status);


--
-- Name: idx_premium_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_premium_requests_user_id ON public.premium_requests USING btree (user_id);


--
-- Name: idx_telegram_users_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telegram_users_partner ON public.telegram_users USING btree (partner_id);


--
-- Name: idx_telegram_users_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telegram_users_state ON public.telegram_users USING btree (state);


--
-- Name: idx_telegram_users_state_premium; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telegram_users_state_premium ON public.telegram_users USING btree (state, premium_until);


--
-- Name: idx_topup_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_topup_requests_created_at ON public.topup_requests USING btree (created_at DESC);


--
-- Name: idx_topup_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_topup_requests_status ON public.topup_requests USING btree (status);


--
-- Name: idx_topup_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_topup_requests_user_id ON public.topup_requests USING btree (user_id);


--
-- Name: idx_user_reactions_emoji; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_reactions_emoji ON public.user_reactions USING btree (emoji);


--
-- Name: idx_user_reactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_reactions_user_id ON public.user_reactions USING btree (user_id);


--
-- Name: idx_waiting_queue_joined; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waiting_queue_joined ON public.waiting_queue USING btree (joined_at);


--
-- Name: chat_pairs chat_pairs_user1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_pairs
    ADD CONSTRAINT chat_pairs_user1_id_fkey FOREIGN KEY (user1_id) REFERENCES public.telegram_users(id) ON DELETE CASCADE;


--
-- Name: chat_pairs chat_pairs_user2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_pairs
    ADD CONSTRAINT chat_pairs_user2_id_fkey FOREIGN KEY (user2_id) REFERENCES public.telegram_users(id) ON DELETE CASCADE;


--
-- Name: topup_requests topup_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topup_requests
    ADD CONSTRAINT topup_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.telegram_users(id) ON DELETE CASCADE;


--
-- Name: waiting_queue waiting_queue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiting_queue
    ADD CONSTRAINT waiting_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.telegram_users(id) ON DELETE CASCADE;


--
-- Name: premium_requests Service role can manage all premium requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage all premium requests" ON public.premium_requests TO service_role USING (true) WITH CHECK (true);


--
-- Name: topup_requests Service role can manage all topup requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage all topup requests" ON public.topup_requests TO service_role USING (true) WITH CHECK (true);


--
-- Name: chat_pairs Service role has full access to chat_pairs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access to chat_pairs" ON public.chat_pairs TO service_role USING (true) WITH CHECK (true);


--
-- Name: coin_transactions Service role has full access to coin_transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access to coin_transactions" ON public.coin_transactions USING (true) WITH CHECK (true);


--
-- Name: telegram_users Service role has full access to telegram_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access to telegram_users" ON public.telegram_users TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_reactions Service role has full access to user_reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access to user_reactions" ON public.user_reactions TO service_role USING (true) WITH CHECK (true);


--
-- Name: waiting_queue Service role has full access to waiting_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access to waiting_queue" ON public.waiting_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: chat_pairs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_pairs ENABLE ROW LEVEL SECURITY;

--
-- Name: coin_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: premium_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.premium_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;

--
-- Name: topup_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.topup_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: user_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: waiting_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waiting_queue ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




COMMIT;