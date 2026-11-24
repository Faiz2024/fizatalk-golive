export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_report_cards: {
        Row: {
          admin_message_id: number | null
          created_at: string
          first_name: string | null
          is_premium: boolean
          last_action: string | null
          premium_until: string | null
          report_count: number
          resolved_at: string | null
          resolved_by: number | null
          sanction_stage: number
          sanction_trigger: string | null
          sanction_violation: string | null
          snippets: Json
          status: string
          target_user_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          admin_message_id?: number | null
          created_at?: string
          first_name?: string | null
          is_premium?: boolean
          last_action?: string | null
          premium_until?: string | null
          report_count?: number
          resolved_at?: string | null
          resolved_by?: number | null
          sanction_stage?: number
          sanction_trigger?: string | null
          sanction_violation?: string | null
          snippets?: Json
          status?: string
          target_user_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          admin_message_id?: number | null
          created_at?: string
          first_name?: string | null
          is_premium?: boolean
          last_action?: string | null
          premium_until?: string | null
          report_count?: number
          resolved_at?: string | null
          resolved_by?: number | null
          sanction_stage?: number
          sanction_trigger?: string | null
          sanction_violation?: string | null
          snippets?: Json
          status?: string
          target_user_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_at: string | null
          blocked_message: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
          is_unblockable: boolean
          reason: string
          unblocked_at: string | null
          unblocked_by: number | null
          user_id: number
          username: string | null
        }
        Insert: {
          blocked_at?: string | null
          blocked_message?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_unblockable?: boolean
          reason: string
          unblocked_at?: string | null
          unblocked_by?: number | null
          user_id: number
          username?: string | null
        }
        Update: {
          blocked_at?: string | null
          blocked_message?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_unblockable?: boolean
          reason?: string
          unblocked_at?: string | null
          unblocked_by?: number | null
          user_id?: number
          username?: string | null
        }
        Relationships: []
      }
      bot_logs: {
        Row: {
          context: Json | null
          created_at: string
          event: string
          id: string
          level: string
          message: string | null
          source: string
          user_id: number | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          event: string
          id?: string
          level: string
          message?: string | null
          source: string
          user_id?: number | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          event?: string
          id?: string
          level?: string
          message?: string | null
          source?: string
          user_id?: number | null
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          key: string
          updated_at: string | null
          updated_by: number | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          updated_by?: number | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          updated_by?: number | null
          value?: string
        }
        Relationships: []
      }
      call_invitations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          join_token: string | null
          recipient_id: number
          recipient_redeemed_at: string | null
          requester_id: number
          requester_redeemed_at: string | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          join_token?: string | null
          recipient_id: number
          recipient_redeemed_at?: string | null
          requester_id: number
          requester_redeemed_at?: string | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          join_token?: string | null
          recipient_id?: number
          recipient_redeemed_at?: string | null
          requester_id?: number
          requester_redeemed_at?: string | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_invitations_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invitations_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invitations_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invitations_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_agent_posts: {
        Row: {
          admin_id: number | null
          admin_message_id: number | null
          admin_rough_text: string | null
          channel_message_id: number | null
          content: string
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          kind: string
          metadata: Json
          posted_at: string | null
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          admin_id?: number | null
          admin_message_id?: number | null
          admin_rough_text?: string | null
          channel_message_id?: number | null
          content?: string
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: string
          kind: string
          metadata?: Json
          posted_at?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          admin_id?: number | null
          admin_message_id?: number | null
          admin_rough_text?: string | null
          channel_message_id?: number | null
          content?: string
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: string
          kind?: string
          metadata?: Json
          posted_at?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      channel_agent_state: {
        Row: {
          created_at: string
          job_key: string
          last_run_at: string | null
          last_summary_at: string | null
          lease_expires_at: string | null
          lease_token: string | null
          pause_reason: string | null
          resume_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          job_key: string
          last_run_at?: string | null
          last_summary_at?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          pause_reason?: string | null
          resume_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          job_key?: string
          last_run_at?: string | null
          last_summary_at?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          pause_reason?: string | null
          resume_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      channel_feedback: {
        Row: {
          content: string
          created_at: string
          id: string
          post_id: string | null
          summarized_at: string | null
          user_id: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          post_id?: string | null
          summarized_at?: string | null
          user_id: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          post_id?: string | null
          summarized_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_feedback_post_fk"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "channel_agent_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          type: string
          user_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          type: string
          user_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          type?: string
          user_id?: number
        }
        Relationships: []
      }
      daily_user_stats: {
        Row: {
          aktif: number
          baru: number
          baru30harilalu: number
          churn: number
          date: string
          inactive30: number
          snapshotted_at: string
        }
        Insert: {
          aktif?: number
          baru?: number
          baru30harilalu?: number
          churn?: number
          date: string
          inactive30?: number
          snapshotted_at?: string
        }
        Update: {
          aktif?: number
          baru?: number
          baru30harilalu?: number
          churn?: number
          date?: string
          inactive30?: number
          snapshotted_at?: string
        }
        Relationships: []
      }
      moderation_reviews: {
        Row: {
          context: string
          created_at: string
          evidence_file_id: string | null
          explanation: string
          id: string
          reported_id: number
          reporter_id: number
          resolved_at: string | null
          resolved_by: number | null
          source_message_id: number | null
          status: string
        }
        Insert: {
          context: string
          created_at?: string
          evidence_file_id?: string | null
          explanation: string
          id?: string
          reported_id: number
          reporter_id: number
          resolved_at?: string | null
          resolved_by?: number | null
          source_message_id?: number | null
          status?: string
        }
        Update: {
          context?: string
          created_at?: string
          evidence_file_id?: string | null
          explanation?: string
          id?: string
          reported_id?: number
          reporter_id?: number
          resolved_at?: string | null
          resolved_by?: number | null
          source_message_id?: number | null
          status?: string
        }
        Relationships: []
      }
      partner_reports: {
        Row: {
          created_at: string | null
          id: string
          penalty_change: number
          report_category: string | null
          report_context: string | null
          report_type: string
          reported_id: number
          reporter_id: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          penalty_change: number
          report_category?: string | null
          report_context?: string | null
          report_type: string
          reported_id: number
          reporter_id: number
        }
        Update: {
          created_at?: string | null
          id?: string
          penalty_change?: number
          report_category?: string | null
          report_context?: string | null
          report_type?: string
          reported_id?: number
          reporter_id?: number
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          account_name: string | null
          account_number: string | null
          created_at: string | null
          display_name: string
          id: string
          instructions: string | null
          is_active: boolean | null
          method_name: string
          qr_code_url: string | null
          updated_at: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string | null
          display_name: string
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          method_name: string
          qr_code_url?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string | null
          display_name?: string
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          method_name?: string
          qr_code_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pending_transactions: {
        Row: {
          admin_notes: string | null
          amount: number
          approved_at: string | null
          approved_by: number | null
          created_at: string | null
          id: string
          payment_method_id: string | null
          payment_proof_url: string | null
          sakurupiah_trx_id: string | null
          status: string
          telegram_notified: boolean | null
          total_amount: number
          unique_code: number
          updated_at: string | null
          user_id: number
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          approved_at?: string | null
          approved_by?: number | null
          created_at?: string | null
          id?: string
          payment_method_id?: string | null
          payment_proof_url?: string | null
          sakurupiah_trx_id?: string | null
          status?: string
          telegram_notified?: boolean | null
          total_amount: number
          unique_code: number
          updated_at?: string | null
          user_id: number
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: number | null
          created_at?: string | null
          id?: string
          payment_method_id?: string | null
          payment_proof_url?: string | null
          sakurupiah_trx_id?: string | null
          status?: string
          telegram_notified?: boolean | null
          total_amount?: number
          unique_code?: number
          updated_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "pending_transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_requests: {
        Row: {
          created_at: string | null
          duration_days: number
          id: string
          message_id: number | null
          payment_method: string | null
          payment_proof: string | null
          price: number
          processed_at: string | null
          sakurupiah_trx_id: string | null
          status: string
          unique_code: number
          user_id: number
        }
        Insert: {
          created_at?: string | null
          duration_days: number
          id?: string
          message_id?: number | null
          payment_method?: string | null
          payment_proof?: string | null
          price: number
          processed_at?: string | null
          sakurupiah_trx_id?: string | null
          status?: string
          unique_code: number
          user_id: number
        }
        Update: {
          created_at?: string | null
          duration_days?: number
          id?: string
          message_id?: number | null
          payment_method?: string | null
          payment_proof?: string | null
          price?: number
          processed_at?: string | null
          sakurupiah_trx_id?: string | null
          status?: string
          unique_code?: number
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "premium_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      reconnect_requests: {
        Row: {
          created_at: string | null
          id: string
          requester_id: number
          requester_message_id: number | null
          status: string | null
          target_id: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          requester_id: number
          requester_message_id?: number | null
          status?: string | null
          target_id: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          requester_id?: number
          requester_message_id?: number | null
          status?: string | null
          target_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconnect_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconnect_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconnect_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconnect_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      reengagement_clicks: {
        Row: {
          clicked_at: string
          id: number
          template_key: string
          user_id: number | null
        }
        Insert: {
          clicked_at?: string
          id?: number
          template_key: string
          user_id?: number | null
        }
        Update: {
          clicked_at?: string
          id?: number
          template_key?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reengagement_clicks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reengagement_clicks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      reengagement_daily_stats: {
        Row: {
          blocked_count: number
          date: string
          eligible_30d: number
          eligible_7d: number
          eligible_count: number
          error_count: number
          sent_30d: number
          sent_7d: number
          sent_count: number
          updated_at: string
        }
        Insert: {
          blocked_count?: number
          date: string
          eligible_30d?: number
          eligible_7d?: number
          eligible_count?: number
          error_count?: number
          sent_30d?: number
          sent_7d?: number
          sent_count?: number
          updated_at?: string
        }
        Update: {
          blocked_count?: number
          date?: string
          eligible_30d?: number
          eligible_7d?: number
          eligible_count?: number
          error_count?: number
          sent_30d?: number
          sent_7d?: number
          sent_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      referral_cashouts: {
        Row: {
          admin_message_id: number | null
          admin_notes: string | null
          amount: number
          created_at: string
          ewallet_name: string
          ewallet_number: string
          ewallet_type: string
          id: string
          processed_at: string | null
          processed_by: number | null
          qualified_at_request: number
          status: string
          updated_at: string
          user_id: number
        }
        Insert: {
          admin_message_id?: number | null
          admin_notes?: string | null
          amount?: number
          created_at?: string
          ewallet_name: string
          ewallet_number: string
          ewallet_type: string
          id?: string
          processed_at?: string | null
          processed_by?: number | null
          qualified_at_request?: number
          status?: string
          updated_at?: string
          user_id: number
        }
        Update: {
          admin_message_id?: number | null
          admin_notes?: string | null
          amount?: number
          created_at?: string
          ewallet_name?: string
          ewallet_number?: string
          ewallet_type?: string
          id?: string
          processed_at?: string | null
          processed_by?: number | null
          qualified_at_request?: number
          status?: string
          updated_at?: string
          user_id?: number
        }
        Relationships: []
      }
      referral_reward_claims: {
        Row: {
          created_at: string
          id: string
          premium_seconds: number
          referrals_consumed: number
          reward_type: string
          user_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          premium_seconds: number
          referrals_consumed: number
          reward_type: string
          user_id: number
        }
        Update: {
          created_at?: string
          id?: string
          premium_seconds?: number
          referrals_consumed?: number
          reward_type?: string
          user_id?: number
        }
        Relationships: []
      }
      referrals: {
        Row: {
          consumed_at: string | null
          created_at: string
          id: string
          qualified_at: string | null
          referred_id: number
          referrer_id: number
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          qualified_at?: string | null
          referred_id: number
          referrer_id: number
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          qualified_at?: string | null
          referred_id?: number
          referrer_id?: number
        }
        Relationships: []
      }
      sticker_packs: {
        Row: {
          added_at: string | null
          fiza_pack_name: string | null
          id: number
          pack_name: string
          requester_id: number | null
          status: string
          submission_count: number
          submitter_ids: number[] | null
          updated_at: string | null
        }
        Insert: {
          added_at?: string | null
          fiza_pack_name?: string | null
          id?: number
          pack_name: string
          requester_id?: number | null
          status?: string
          submission_count?: number
          submitter_ids?: number[] | null
          updated_at?: string | null
        }
        Update: {
          added_at?: string | null
          fiza_pack_name?: string | null
          id?: number
          pack_name?: string
          requester_id?: number | null
          status?: string
          submission_count?: number
          submitter_ids?: number[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      telegram_users: {
        Row: {
          cashout_draft: Json | null
          chat_end_count: number | null
          chats_since_premium_shadow: number
          clean_days_streak: number
          coins: number
          conduct_agreement_pending: boolean
          created_at: string
          first_name: string | null
          gender: string | null
          has_received_special_promo: boolean | null
          id: number
          is_channel_member: boolean | null
          is_face_verified: boolean
          is_tiktok_mode: boolean | null
          last_active: string
          last_channel_invite_sent_at: string | null
          last_incoming_msg_at: string | null
          last_negative_report_at: string | null
          last_partners: number[] | null
          last_penalty_decay_at: string | null
          last_promo_sent_at: string | null
          last_reengagement_message_id: number | null
          last_reengagement_sent_at: string | null
          location: string | null
          matched_at: string | null
          moderation_state: string
          negative_reports_count: number
          partner_id: number | null
          penalty_points: number | null
          pending_profile_photo_file_id: string | null
          photo_auto_disabled: boolean
          photo_match_daily_count: number
          photo_match_daily_date: string | null
          premium_until: string | null
          profile_flow: string | null
          profile_photo_enabled: boolean
          profile_photo_file_id: string | null
          referral_qualified_count: number
          referral_rewards_claimed: number
          referred_by: number | null
          report_draft: Json | null
          report_lock_until: string | null
          reports_decay_at: string | null
          sanction_counted_since: string | null
          sanction_level: number
          sanction_lock_count: number
          sanction_violation: string | null
          shadowban_until: string | null
          spam_warning_until: string | null
          spam_warnings: number | null
          special_promo_purchased_at: string | null
          special_promo_sent_at: string | null
          state: Database["public"]["Enums"]["user_state"]
          target_gender: string | null
          target_location: string | null
          tos_version_seen: number
          total_response_count: number
          total_response_time_seconds: number
          unacknowledged_reports_count: number | null
          username: string | null
          verification_admin_msg_id: number | null
          verification_gesture: string | null
          verification_status: string
        }
        Insert: {
          cashout_draft?: Json | null
          chat_end_count?: number | null
          chats_since_premium_shadow?: number
          clean_days_streak?: number
          coins?: number
          conduct_agreement_pending?: boolean
          created_at?: string
          first_name?: string | null
          gender?: string | null
          has_received_special_promo?: boolean | null
          id: number
          is_channel_member?: boolean | null
          is_face_verified?: boolean
          is_tiktok_mode?: boolean | null
          last_active?: string
          last_channel_invite_sent_at?: string | null
          last_incoming_msg_at?: string | null
          last_negative_report_at?: string | null
          last_partners?: number[] | null
          last_penalty_decay_at?: string | null
          last_promo_sent_at?: string | null
          last_reengagement_message_id?: number | null
          last_reengagement_sent_at?: string | null
          location?: string | null
          matched_at?: string | null
          moderation_state?: string
          negative_reports_count?: number
          partner_id?: number | null
          penalty_points?: number | null
          pending_profile_photo_file_id?: string | null
          photo_auto_disabled?: boolean
          photo_match_daily_count?: number
          photo_match_daily_date?: string | null
          premium_until?: string | null
          profile_flow?: string | null
          profile_photo_enabled?: boolean
          profile_photo_file_id?: string | null
          referral_qualified_count?: number
          referral_rewards_claimed?: number
          referred_by?: number | null
          report_draft?: Json | null
          report_lock_until?: string | null
          reports_decay_at?: string | null
          sanction_counted_since?: string | null
          sanction_level?: number
          sanction_lock_count?: number
          sanction_violation?: string | null
          shadowban_until?: string | null
          spam_warning_until?: string | null
          spam_warnings?: number | null
          special_promo_purchased_at?: string | null
          special_promo_sent_at?: string | null
          state?: Database["public"]["Enums"]["user_state"]
          target_gender?: string | null
          target_location?: string | null
          tos_version_seen?: number
          total_response_count?: number
          total_response_time_seconds?: number
          unacknowledged_reports_count?: number | null
          username?: string | null
          verification_admin_msg_id?: number | null
          verification_gesture?: string | null
          verification_status?: string
        }
        Update: {
          cashout_draft?: Json | null
          chat_end_count?: number | null
          chats_since_premium_shadow?: number
          clean_days_streak?: number
          coins?: number
          conduct_agreement_pending?: boolean
          created_at?: string
          first_name?: string | null
          gender?: string | null
          has_received_special_promo?: boolean | null
          id?: number
          is_channel_member?: boolean | null
          is_face_verified?: boolean
          is_tiktok_mode?: boolean | null
          last_active?: string
          last_channel_invite_sent_at?: string | null
          last_incoming_msg_at?: string | null
          last_negative_report_at?: string | null
          last_partners?: number[] | null
          last_penalty_decay_at?: string | null
          last_promo_sent_at?: string | null
          last_reengagement_message_id?: number | null
          last_reengagement_sent_at?: string | null
          location?: string | null
          matched_at?: string | null
          moderation_state?: string
          negative_reports_count?: number
          partner_id?: number | null
          penalty_points?: number | null
          pending_profile_photo_file_id?: string | null
          photo_auto_disabled?: boolean
          photo_match_daily_count?: number
          photo_match_daily_date?: string | null
          premium_until?: string | null
          profile_flow?: string | null
          profile_photo_enabled?: boolean
          profile_photo_file_id?: string | null
          referral_qualified_count?: number
          referral_rewards_claimed?: number
          referred_by?: number | null
          report_draft?: Json | null
          report_lock_until?: string | null
          reports_decay_at?: string | null
          sanction_counted_since?: string | null
          sanction_level?: number
          sanction_lock_count?: number
          sanction_violation?: string | null
          shadowban_until?: string | null
          spam_warning_until?: string | null
          spam_warnings?: number | null
          special_promo_purchased_at?: string | null
          special_promo_sent_at?: string | null
          state?: Database["public"]["Enums"]["user_state"]
          target_gender?: string | null
          target_location?: string | null
          tos_version_seen?: number
          total_response_count?: number
          total_response_time_seconds?: number
          unacknowledged_reports_count?: number | null
          username?: string | null
          verification_admin_msg_id?: number | null
          verification_gesture?: string | null
          verification_status?: string
        }
        Relationships: []
      }
      topup_requests: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          message_id: number | null
          payment_method: string | null
          payment_proof: string | null
          processed_at: string | null
          sakurupiah_trx_id: string | null
          status: string
          unique_code: number
          user_id: number
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          message_id?: number | null
          payment_method?: string | null
          payment_proof?: string | null
          processed_at?: string | null
          sakurupiah_trx_id?: string | null
          status?: string
          unique_code: number
          user_id: number
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          message_id?: number | null
          payment_method?: string | null
          payment_proof?: string | null
          processed_at?: string | null
          sakurupiah_trx_id?: string | null
          status?: string
          unique_code?: number
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "topup_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topup_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
      waiting_queue: {
        Row: {
          joined_at: string
          user_id: number
        }
        Insert: {
          joined_at?: string
          user_id: number
        }
        Update: {
          joined_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "waiting_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "telegram_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiting_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_eligible_reengagement_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_eligible_reengagement_users: {
        Row: {
          chat_end_count: number | null
          coins: number | null
          created_at: string | null
          first_name: string | null
          gender: string | null
          id: number | null
          is_channel_member: boolean | null
          is_tiktok_mode: boolean | null
          last_active: string | null
          last_partners: number[] | null
          last_promo_sent_at: string | null
          last_reengagement_message_id: number | null
          last_reengagement_sent_at: string | null
          location: string | null
          partner_id: number | null
          penalty_points: number | null
          premium_until: string | null
          spam_warning_until: string | null
          spam_warnings: number | null
          state: Database["public"]["Enums"]["user_state"] | null
          target_gender: string | null
          target_location: string | null
          unacknowledged_reports_count: number | null
          username: string | null
        }
        Insert: {
          chat_end_count?: number | null
          coins?: number | null
          created_at?: string | null
          first_name?: string | null
          gender?: string | null
          id?: number | null
          is_channel_member?: boolean | null
          is_tiktok_mode?: boolean | null
          last_active?: string | null
          last_partners?: number[] | null
          last_promo_sent_at?: string | null
          last_reengagement_message_id?: number | null
          last_reengagement_sent_at?: string | null
          location?: string | null
          partner_id?: number | null
          penalty_points?: number | null
          premium_until?: string | null
          spam_warning_until?: string | null
          spam_warnings?: number | null
          state?: Database["public"]["Enums"]["user_state"] | null
          target_gender?: string | null
          target_location?: string | null
          unacknowledged_reports_count?: number | null
          username?: string | null
        }
        Update: {
          chat_end_count?: number | null
          coins?: number | null
          created_at?: string | null
          first_name?: string | null
          gender?: string | null
          id?: number | null
          is_channel_member?: boolean | null
          is_tiktok_mode?: boolean | null
          last_active?: string | null
          last_partners?: number[] | null
          last_promo_sent_at?: string | null
          last_reengagement_message_id?: number | null
          last_reengagement_sent_at?: string | null
          location?: string | null
          partner_id?: number | null
          penalty_points?: number | null
          premium_until?: string | null
          spam_warning_until?: string | null
          spam_warnings?: number | null
          state?: Database["public"]["Enums"]["user_state"] | null
          target_gender?: string | null
          target_location?: string | null
          unacknowledged_reports_count?: number | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_conduct_agreement: { Args: { p_user_id: number }; Returns: Json }
      add_response_stats: {
        Args: { p_count: number; p_seconds: number; p_user_id: number }
        Returns: undefined
      }
      admin_process_media_report: {
        Args: { p_action: string; p_sender_id: number }
        Returns: Json
      }
      admin_report_action: {
        Args: { p_action: string; p_admin_id: number; p_user_id: number }
        Returns: Json
      }
      admin_set_user_block: {
        Args: {
          p_action: string
          p_admin_id: number
          p_duration?: string
          p_reason?: string
          p_target: string
        }
        Returns: Json
      }
      append_admin_report_card: {
        Args: {
          p_category: string
          p_context: string
          p_detail: string
          p_label: string
          p_source_id: number
          p_target_user_id: number
        }
        Returns: Json
      }
      apply_daily_penalty_decay: { Args: never; Returns: number }
      begin_report_draft: {
        Args: {
          p_context: string
          p_reported_id: number
          p_reporter_id: number
          p_source_id: number
        }
        Returns: Json
      }
      bridge_exec_sql: {
        Args: { p_params?: Json; p_sql: string }
        Returns: Json
      }
      cancel_fine_transaction: { Args: { p_user_id: number }; Returns: Json }
      cancel_premium_transaction: { Args: { p_user_id: number }; Returns: Json }
      cancel_report_draft: { Args: { p_user_id: number }; Returns: undefined }
      cancel_topup_transaction: { Args: { p_user_id: number }; Returns: Json }
      channel_post_action: {
        Args: {
          p_action: string
          p_admin_id: number
          p_post_id: string
          p_rough_text?: string
        }
        Returns: Json
      }
      check_and_claim_special_promo: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      check_channel_invite_eligibility: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      claim_channel_agent_schedule: {
        Args: { p_lease_seconds?: number }
        Returns: Json
      }
      claim_queued_channel_post: { Args: { p_post_id: string }; Returns: Json }
      claim_reengagement_batch: {
        Args: { p_limit: number }
        Returns: {
          first_name: string
          id: number
          last_reengagement_message_id: number
          prev_sent_at: string
        }[]
      }
      claim_referral_reward: {
        Args: { p_reward_type: string; p_user_id: number }
        Returns: Json
      }
      cleanup_inactive_users: { Args: never; Returns: undefined }
      complete_channel_post_generation: {
        Args: { p_content: string; p_post_id: string; p_summary?: Json }
        Returns: boolean
      }
      comprehensive_search_action: {
        Args: {
          p_first_name?: string
          p_is_next?: boolean
          p_target_partner_id?: number
          p_user_id: number
          p_username?: string
        }
        Returns: Json
      }
      create_channel_admin_post: {
        Args: {
          p_admin_id: number
          p_kind: string
          p_metadata?: Json
          p_rough_text: string
        }
        Returns: Json
      }
      create_channel_daily_post: {
        Args: { p_dedupe_key: string; p_kind: string; p_lease_token: string }
        Returns: Json
      }
      create_channel_feedback_post: {
        Args: { p_lease_token: string; p_limit?: number }
        Returns: Json
      }
      create_channel_feedback_summary: {
        Args: {
          p_admin_id?: number
          p_force?: boolean
          p_lease_token: string
          p_limit?: number
        }
        Returns: Json
      }
      create_chat_call_invite: {
        Args: { p_requester_id: number }
        Returns: Json
      }
      current_admin_report_card: {
        Args: { p_target_user_id: number }
        Returns: Json
      }
      decay_negative_reports: { Args: { p_user_id: number }; Returns: number }
      delete_profile_photo: { Args: { p_user_id: number }; Returns: Json }
      end_chat_comprehensive: { Args: { p_user_id: number }; Returns: Json }
      exchange_chat_call_invite: {
        Args: { p_join_token: string; p_user_id: number }
        Returns: Json
      }
      fail_channel_post_generation: {
        Args: { p_error: string; p_post_id: string }
        Returns: undefined
      }
      find_and_pair_partner: { Args: { p_user_id: number }; Returns: Json }
      finish_channel_agent_schedule: {
        Args: { p_lease_token: string }
        Returns: undefined
      }
      finish_reengagement_batch: {
        Args: { p_results: Json }
        Returns: undefined
      }
      generate_unique_payment_code: { Args: never; Returns: number }
      get_admin_dashboard_stats: { Args: { p_force?: boolean }; Returns: Json }
      get_chat_envelope: { Args: { p_user_id: number }; Returns: Json }
      get_partner_settings: { Args: { p_partner_id: number }; Returns: Json }
      get_referral_cashout_amount: { Args: never; Returns: number }
      get_referral_stats: { Args: never; Returns: Json }
      get_referral_status: { Args: { p_user_id: number }; Returns: Json }
      get_user_reputation: { Args: { p_user_id: number }; Returns: Json }
      handle_end_chat_promo_logic: {
        Args: { p_user_id: number }
        Returns: Json
      }
      initiate_reconnect: {
        Args: {
          p_message_id: number
          p_requester_id: number
          p_target_id: number
        }
        Returns: Json
      }
      log_bot_event: {
        Args: {
          p_context?: Json
          p_event: string
          p_level: string
          p_message?: string
          p_source: string
          p_user_id?: number
        }
        Returns: undefined
      }
      mark_channel_post_posted: {
        Args: { p_channel_message_id: number; p_post_id: string }
        Returns: boolean
      }
      pause_channel_agent: {
        Args: { p_reason: string; p_resume_at?: string }
        Returns: undefined
      }
      premium_purchase_allowed: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      process_gift_transaction: {
        Args: {
          p_gift_id: string
          p_gift_name: string
          p_gift_price: number
          p_sender_id: number
        }
        Returns: Json
      }
      process_referral_cashout: {
        Args: { p_action: string; p_admin_id: number; p_request_id: string }
        Returns: Json
      }
      prune_bot_logs: { Args: never; Returns: Json }
      record_chat_response: {
        Args: { p_partner_id: number; p_sender_id: number }
        Returns: undefined
      }
      refresh_admin_dashboard_stats_uncached: {
        Args: { p_force?: boolean }
        Returns: Json
      }
      refresh_referral_stats_uncached: { Args: never; Returns: Json }
      register_referral: {
        Args: { p_new_user_id: number; p_referrer_id: number }
        Returns: Json
      }
      reject_referral_cashout: {
        Args: { p_admin_id: number; p_reason: string; p_request_id: string }
        Returns: Json
      }
      report_category_threshold: {
        Args: { p_category: string; p_context: string }
        Returns: number
      }
      report_sanction_stage: {
        Args: {
          p_current_level: number
          p_lock_count: number
          p_trigger_code: string
        }
        Returns: number
      }
      report_violation_label: {
        Args: { p_category: string; p_context: string }
        Returns: string
      }
      request_referral_cashout: { Args: { p_user_id: number }; Returns: Json }
      reset_payment_state: { Args: { p_user_id: number }; Returns: Json }
      resolve_admin_report_card: {
        Args: { p_action: string; p_admin_id: number; p_target_user_id: number }
        Returns: Json
      }
      resolve_chat_call_invite: {
        Args: { p_action: string; p_actor_id: number; p_invite_id: string }
        Returns: Json
      }
      resolve_face_verification: {
        Args: { p_action: string; p_user_id: number }
        Returns: Json
      }
      resolve_moderation_review: {
        Args: { p_action: string; p_admin_id: number; p_review_id: string }
        Returns: Json
      }
      resolve_reconnect: {
        Args: { p_action: string; p_request_id: string }
        Returns: Json
      }
      restoration_payment_allowed: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      resume_channel_agent: { Args: never; Returns: undefined }
      search_or_next_partner: {
        Args: {
          p_first_name?: string
          p_is_next?: boolean
          p_target_partner_id?: number
          p_user_id: number
          p_username?: string
        }
        Returns: Json
      }
      set_admin_report_card_message: {
        Args: {
          p_expected_message_id: number
          p_new_message_id: number
          p_target_user_id: number
        }
        Returns: boolean
      }
      set_channel_post_admin_message: {
        Args: { p_message_id: number; p_post_id: string }
        Returns: undefined
      }
      set_profile_flow: {
        Args: { p_flow: string; p_user_id: number }
        Returns: Json
      }
      set_referral_cashout_admin_message: {
        Args: { p_message_id: number; p_request_id: string }
        Returns: undefined
      }
      set_referral_cashout_amount: {
        Args: { p_admin_id: number; p_amount: number }
        Returns: Json
      }
      set_referral_cashout_draft: {
        Args: { p_draft: Json; p_user_id: number }
        Returns: Json
      }
      set_user_payment_state: { Args: { p_user_id: number }; Returns: Json }
      set_verification_admin_message: {
        Args: { p_message_id: number; p_user_id: number }
        Returns: undefined
      }
      should_show_channel_join: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      snapshot_daily_stats: { Args: { p_target_date?: string }; Returns: Json }
      submit_channel_feedback: {
        Args: { p_text: string; p_user_id: number }
        Returns: Json
      }
      submit_context_report: {
        Args: {
          p_category: string
          p_context: string
          p_detail?: string
          p_evidence?: string
          p_explanation?: string
          p_reported_id: number
          p_reporter_id: number
          p_source_id?: number
        }
        Returns: Json
      }
      submit_partner_report: {
        Args: {
          p_report_type: string
          p_reported_id: number
          p_reporter_id: number
        }
        Returns: Json
      }
      submit_profile_photo: {
        Args: { p_file_id: string; p_gesture: string; p_user_id: number }
        Returns: Json
      }
      submit_verification_video: { Args: { p_user_id: number }; Returns: Json }
      toggle_profile_photo_mode: { Args: { p_user_id: number }; Returns: Json }
      toggle_tiktok_mode: { Args: { p_user_id: number }; Returns: Json }
      update_daily_eligible_count: { Args: never; Returns: undefined }
      update_last_active_daily: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      update_target_gender: {
        Args: { p_target_gender: string; p_user_id: number }
        Returns: Json
      }
      update_target_location: {
        Args: { p_target_location: string; p_user_id: number }
        Returns: Json
      }
      update_user_gender: {
        Args: { p_gender: string; p_user_id: number }
        Returns: Json
      }
      update_user_location: {
        Args: { p_location: string; p_user_id: number }
        Returns: Json
      }
      upsert_user_optimized: {
        Args: {
          p_first_name?: string
          p_update_last_active?: boolean
          p_user_id: number
          p_username?: string
        }
        Returns: Json
      }
    }
    Enums: {
      user_state: "idle" | "waiting" | "chatting" | "awaiting_payment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_state: ["idle", "waiting", "chatting", "awaiting_payment"],
    },
  },
} as const
