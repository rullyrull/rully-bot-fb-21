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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          default_channel_id: string | null
          default_channel_title: string | null
          default_description: string
          default_kind: string
          default_privacy: string
          id: string
          slot_times: string
          timezone: string
          updated_at: string
        }
        Insert: {
          default_channel_id?: string | null
          default_channel_title?: string | null
          default_description?: string
          default_kind?: string
          default_privacy?: string
          id?: string
          slot_times?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          default_channel_id?: string | null
          default_channel_title?: string | null
          default_description?: string
          default_kind?: string
          default_privacy?: string
          id?: string
          slot_times?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      channel_autopilot: {
        Row: {
          channel_id: string
          channel_title: string | null
          created_at: string
          enabled: boolean
          folder_url: string
          id: string
          kind: string
          last_scan_at: string | null
          last_scan_result: string | null
          max_per_scan: number
          privacy: string
          slot_times: string
          timezone: string
          updated_at: string
        }
        Insert: {
          channel_id: string
          channel_title?: string | null
          created_at?: string
          enabled?: boolean
          folder_url: string
          id?: string
          kind?: string
          last_scan_at?: string | null
          last_scan_result?: string | null
          max_per_scan?: number
          privacy?: string
          slot_times?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          channel_id?: string
          channel_title?: string | null
          created_at?: string
          enabled?: boolean
          folder_url?: string
          id?: string
          kind?: string
          last_scan_at?: string | null
          last_scan_result?: string | null
          max_per_scan?: number
          privacy?: string
          slot_times?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      channel_insights: {
        Row: {
          avg_views: number
          best_hours: string | null
          channel_id: string
          channel_title: string | null
          created_at: string
          guidance: string | null
          id: string
          sample_size: number
          updated_at: string
        }
        Insert: {
          avg_views?: number
          best_hours?: string | null
          channel_id: string
          channel_title?: string | null
          created_at?: string
          guidance?: string | null
          id?: string
          sample_size?: number
          updated_at?: string
        }
        Update: {
          avg_views?: number
          best_hours?: string | null
          channel_id?: string
          channel_title?: string | null
          created_at?: string
          guidance?: string | null
          id?: string
          sample_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      uploads: {
        Row: {
          audit_result: string | null
          audited_at: string | null
          channel_id: string | null
          channel_title: string | null
          created_at: string
          description: string | null
          drive_file_id: string | null
          drive_url: string
          error: string | null
          id: string
          kind: string
          privacy: string
          published_at: string | null
          scheduled_at: string | null
          status: string
          title: string
          updated_at: string
          video_id: string | null
        }
        Insert: {
          audit_result?: string | null
          audited_at?: string | null
          channel_id?: string | null
          channel_title?: string | null
          created_at?: string
          description?: string | null
          drive_file_id?: string | null
          drive_url: string
          error?: string | null
          id?: string
          kind?: string
          privacy?: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          title: string
          updated_at?: string
          video_id?: string | null
        }
        Update: {
          audit_result?: string | null
          audited_at?: string | null
          channel_id?: string | null
          channel_title?: string | null
          created_at?: string
          description?: string | null
          drive_file_id?: string | null
          drive_url?: string
          error?: string | null
          id?: string
          kind?: string
          privacy?: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          video_id?: string | null
        }
        Relationships: []
      }
      video_stats: {
        Row: {
          channel_id: string | null
          checked_at: string
          comments: number
          created_at: string
          id: string
          kind: string | null
          likes: number
          published_at: string | null
          title: string | null
          video_id: string
          views: number
        }
        Insert: {
          channel_id?: string | null
          checked_at?: string
          comments?: number
          created_at?: string
          id?: string
          kind?: string | null
          likes?: number
          published_at?: string | null
          title?: string | null
          video_id: string
          views?: number
        }
        Update: {
          channel_id?: string | null
          checked_at?: string
          comments?: number
          created_at?: string
          id?: string
          kind?: string | null
          likes?: number
          published_at?: string | null
          title?: string | null
          video_id?: string
          views?: number
        }
        Relationships: []
      }
      youtube_account: {
        Row: {
          access_token: string
          channel_id: string
          channel_title: string | null
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          channel_id: string
          channel_title?: string | null
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          channel_id?: string
          channel_title?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
