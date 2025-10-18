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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          changes: Json | null
          created_at: string | null
          id: string
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string | null
          id?: string
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string | null
          id?: string
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      meter_positions: {
        Row: {
          created_at: string | null
          id: string
          label: string | null
          meter_id: string
          schematic_id: string
          updated_at: string | null
          x_position: number
          y_position: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          label?: string | null
          meter_id: string
          schematic_id: string
          updated_at?: string | null
          x_position: number
          y_position: number
        }
        Update: {
          created_at?: string | null
          id?: string
          label?: string | null
          meter_id?: string
          schematic_id?: string
          updated_at?: string | null
          x_position?: number
          y_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "meter_positions_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_positions_schematic_id_fkey"
            columns: ["schematic_id"]
            isOneToOne: false
            referencedRelation: "schematics"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_readings: {
        Row: {
          created_at: string | null
          id: string
          kwh_value: number
          metadata: Json | null
          meter_id: string
          reading_timestamp: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          kwh_value: number
          metadata?: Json | null
          meter_id: string
          reading_timestamp: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          kwh_value?: number
          metadata?: Json | null
          meter_id?: string
          reading_timestamp?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meter_readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      meters: {
        Row: {
          created_at: string | null
          id: string
          is_revenue_critical: boolean | null
          location: string | null
          meter_number: string
          meter_type: string
          site_id: string
          tariff: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_revenue_critical?: boolean | null
          location?: string | null
          meter_number: string
          meter_type: string
          site_id: string
          tariff?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_revenue_critical?: boolean | null
          location?: string | null
          meter_number?: string
          meter_type?: string
          site_id?: string
          tariff?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meters_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          full_name: string
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          full_name: string
          id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          full_name?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      schematics: {
        Row: {
          created_at: string | null
          description: string | null
          file_path: string
          file_type: string
          id: string
          name: string
          page_number: number | null
          site_id: string
          total_pages: number | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          file_path: string
          file_type: string
          id?: string
          name: string
          page_number?: number | null
          site_id: string
          total_pages?: number | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          file_path?: string
          file_type?: string
          id?: string
          name?: string
          page_number?: number | null
          site_id?: string
          total_pages?: number | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schematics_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          client_id: string
          council_connection_point: string | null
          created_at: string | null
          id: string
          name: string
          supply_authority_id: string | null
          tariff_structure_id: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          client_id: string
          council_connection_point?: string | null
          created_at?: string | null
          id?: string
          name: string
          supply_authority_id?: string | null
          tariff_structure_id?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          client_id?: string
          council_connection_point?: string | null
          created_at?: string | null
          id?: string
          name?: string
          supply_authority_id?: string | null
          tariff_structure_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_supply_authority_id_fkey"
            columns: ["supply_authority_id"]
            isOneToOne: false
            referencedRelation: "supply_authorities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_tariff_structure_id_fkey"
            columns: ["tariff_structure_id"]
            isOneToOne: false
            referencedRelation: "tariff_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_authorities: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          name: string
          nersa_increase_percentage: number | null
          region: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name: string
          nersa_increase_percentage?: number | null
          region?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name?: string
          nersa_increase_percentage?: number | null
          region?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tariff_blocks: {
        Row: {
          block_number: number
          created_at: string | null
          energy_charge_cents: number
          id: string
          kwh_from: number
          kwh_to: number | null
          tariff_structure_id: string
        }
        Insert: {
          block_number: number
          created_at?: string | null
          energy_charge_cents: number
          id?: string
          kwh_from: number
          kwh_to?: number | null
          tariff_structure_id: string
        }
        Update: {
          block_number?: number
          created_at?: string | null
          energy_charge_cents?: number
          id?: string
          kwh_from?: number
          kwh_to?: number | null
          tariff_structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariff_blocks_tariff_structure_id_fkey"
            columns: ["tariff_structure_id"]
            isOneToOne: false
            referencedRelation: "tariff_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_charges: {
        Row: {
          charge_amount: number
          charge_type: string
          created_at: string | null
          description: string | null
          id: string
          tariff_structure_id: string
          unit: string
        }
        Insert: {
          charge_amount: number
          charge_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          tariff_structure_id: string
          unit: string
        }
        Update: {
          charge_amount?: number
          charge_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          tariff_structure_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariff_charges_tariff_structure_id_fkey"
            columns: ["tariff_structure_id"]
            isOneToOne: false
            referencedRelation: "tariff_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_structures: {
        Row: {
          active: boolean | null
          created_at: string | null
          description: string | null
          effective_from: string
          effective_to: string | null
          id: string
          meter_configuration: string | null
          name: string
          supply_authority_id: string
          tariff_type: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          description?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          meter_configuration?: string | null
          name: string
          supply_authority_id: string
          tariff_type: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          meter_configuration?: string | null
          name?: string
          supply_authority_id?: string
          tariff_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_structures_supply_authority_id_fkey"
            columns: ["supply_authority_id"]
            isOneToOne: false
            referencedRelation: "supply_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "auditor" | "operator"
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
      app_role: ["admin", "auditor", "operator"],
    },
  },
} as const
