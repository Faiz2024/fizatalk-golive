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
        ]
      }
      premium_requests: {
        Row: {
          created_at: string | null
          duration_days: number
          id: string
          message_id: number | null
          payment_proof: string | null
          price: number
          processed_at: string | null
          status: string
          unique_code: number
          user_id: number
        }
        Insert: {
          created_at?: string | null
          duration_days: number
          id?: string
          message_id?: number | null
          payment_proof?: string | null
          price: number
          processed_at?: string | null
          status?: string
          unique_code: number
          user_id: number
        }
        Update: {
          created_at?: string | null
          duration_days?: number
          id?: string
          message_id?: number | null
          payment_proof?: string | null
          price?: number
          processed_at?: string | null
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
        ]
      }
      promo_queue: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          message_text: string
          photo_url: string | null
          promo_buttons: Json | null
          sent_message_id: number | null
          status: string
          user_id: number
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          message_text: string
          photo_url?: string | null
          promo_buttons?: Json | null
          sent_message_id?: number | null
          status?: string
          user_id: number
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          message_text?: string
          photo_url?: string | null
          promo_buttons?: Json | null
          sent_message_id?: number | null
          status?: string
          user_id?: number
        }
        Relationships: []
      }
      spam_detection: {
        Row: {
          detected_at: string | null
          detection_type: string
          id: string
          message_hash: string
          message_preview: string | null
          user_id: number
        }
        Insert: {
          detected_at?: string | null
          detection_type: string
          id?: string
          message_hash: string
          message_preview?: string | null
          user_id: number
        }
        Update: {
          detected_at?: string | null
          detection_type?: string
          id?: string
          message_hash?: string
          message_preview?: string | null
          user_id?: number
        }
        Relationships: []
      }
      telegram_users: {
        Row: {
          coins: number
          created_at: string
          first_name: string | null
          gender: string | null
          id: number
          last_active: string
          location: string | null
          partner_id: number | null
          premium_until: string | null
          state: Database["public"]["Enums"]["user_state"]
          target_gender: string | null
          target_location: string | null
          username: string | null
        }
        Insert: {
          coins?: number
          created_at?: string
          first_name?: string | null
          gender?: string | null
          id: number
          last_active?: string
          location?: string | null
          partner_id?: number | null
          premium_until?: string | null
          state?: Database["public"]["Enums"]["user_state"]
          target_gender?: string | null
          target_location?: string | null
          username?: string | null
        }
        Update: {
          coins?: number
          created_at?: string
          first_name?: string | null
          gender?: string | null
          id?: number
          last_active?: string
          location?: string | null
          partner_id?: number | null
          premium_until?: string | null
          state?: Database["public"]["Enums"]["user_state"]
          target_gender?: string | null
          target_location?: string | null
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
          payment_proof: string | null
          processed_at: string | null
          status: string
          unique_code: number
          user_id: number
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          message_id?: number | null
          payment_proof?: string | null
          processed_at?: string | null
          status?: string
          unique_code: number
          user_id: number
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          message_id?: number | null
          payment_proof?: string | null
          processed_at?: string | null
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
        ]
      }
      user_reactions: {
        Row: {
          created_at: string
          emoji: string
          from_user_id: number
          id: string
          user_id: number
        }
        Insert: {
          created_at?: string
          emoji: string
          from_user_id: number
          id?: string
          user_id: number
        }
        Update: {
          created_at?: string
          emoji?: string
          from_user_id?: number
          id?: string
          user_id?: number
        }
        Relationships: []
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_inactive_users: { Args: never; Returns: undefined }
      find_and_pair_partner: { Args: { p_user_id: number }; Returns: Json }
      generate_unique_payment_code: { Args: never; Returns: number }
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
