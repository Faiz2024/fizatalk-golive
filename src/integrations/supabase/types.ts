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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      blocked_users: {
        Row: {
          blocked_at: string | null
          blocked_message: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
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
      partner_reports: {
        Row: {
          created_at: string | null
          id: string
          penalty_change: number
          report_type: string
          reported_id: number
          reporter_id: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          penalty_change: number
          report_type: string
          reported_id: number
          reporter_id: number
        }
        Update: {
          created_at?: string | null
          id?: string
          penalty_change?: number
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
          eligible_count: number
          error_count: number
          sent_count: number
          updated_at: string
        }
        Insert: {
          blocked_count?: number
          date: string
          eligible_count?: number
          error_count?: number
          sent_count?: number
          updated_at?: string
        }
        Update: {
          blocked_count?: number
          date?: string
          eligible_count?: number
          error_count?: number
          sent_count?: number
          updated_at?: string
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
          updated_at?: string | null
        }
        Relationships: []
      }
      telegram_users: {
        Row: {
          chat_end_count: number | null
          coins: number
          created_at: string
          first_name: string | null
          gender: string | null
          id: number
          is_channel_member: boolean | null
          is_tiktok_mode: boolean | null
          last_active: string
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
          state: Database["public"]["Enums"]["user_state"]
          target_gender: string | null
          target_location: string | null
          unacknowledged_reports_count: number | null
          username: string | null
        }
        Insert: {
          chat_end_count?: number | null
          coins?: number
          created_at?: string
          first_name?: string | null
          gender?: string | null
          id: number
          is_channel_member?: boolean | null
          is_tiktok_mode?: boolean | null
          last_active?: string
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
          state?: Database["public"]["Enums"]["user_state"]
          target_gender?: string | null
          target_location?: string | null
          unacknowledged_reports_count?: number | null
          username?: string | null
        }
        Update: {
          chat_end_count?: number | null
          coins?: number
          created_at?: string
          first_name?: string | null
          gender?: string | null
          id?: number
          is_channel_member?: boolean | null
          is_tiktok_mode?: boolean | null
          last_active?: string
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
          state?: Database["public"]["Enums"]["user_state"]
          target_gender?: string | null
          target_location?: string | null
          unacknowledged_reports_count?: number | null
          username?: string | null
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
      apply_daily_penalty_decay: { Args: never; Returns: number }
      bridge_exec_sql: {
        Args: { p_params?: Json; p_sql: string }
        Returns: Json
      }
      cancel_fine_transaction: { Args: { p_user_id: number }; Returns: Json }
      cancel_premium_transaction: { Args: { p_user_id: number }; Returns: Json }
      cancel_topup_transaction: { Args: { p_user_id: number }; Returns: Json }
      cleanup_inactive_users: { Args: never; Returns: undefined }
      comprehensive_search_action: {
        Args: {
          p_first_name?: string
          p_is_next?: boolean
          p_user_id: number
          p_username?: string
        }
        Returns: Json
      }
      end_chat_comprehensive: { Args: { p_user_id: number }; Returns: Json }
      find_and_pair_partner: { Args: { p_user_id: number }; Returns: Json }
      generate_unique_payment_code: { Args: never; Returns: number }
      get_admin_dashboard_stats: { Args: never; Returns: Json }
      get_partner_settings: { Args: { p_partner_id: number }; Returns: Json }
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
      process_gift_transaction: {
        Args: {
          p_gift_id: string
          p_gift_name: string
          p_gift_price: number
          p_sender_id: number
        }
        Returns: Json
      }
      prune_bot_logs: { Args: never; Returns: Json }
      reset_payment_state: { Args: { p_user_id: number }; Returns: Json }
      resolve_reconnect: {
        Args: { p_action: string; p_request_id: string }
        Returns: Json
      }
      search_or_next_partner: {
        Args: { p_is_next?: boolean; p_user_id: number }
        Returns: Json
      }
      set_user_payment_state: { Args: { p_user_id: number }; Returns: Json }
      should_show_channel_join: {
        Args: { p_user_id: number }
        Returns: boolean
      }
      snapshot_daily_stats: { Args: { p_target_date?: string }; Returns: Json }
      submit_partner_report: {
        Args: {
          p_report_type: string
          p_reported_id: number
          p_reporter_id: number
        }
        Returns: Json
      }
      toggle_tiktok_mode: { Args: { p_user_id: number }; Returns: Json }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
