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
          logo_url: string | null
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
          logo_url?: string | null
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
          logo_url?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      document_extractions: {
        Row: {
          confidence_score: number | null
          created_at: string
          currency: string | null
          document_id: string
          extracted_at: string
          extracted_data: Json | null
          id: string
          period_end: string | null
          period_start: string | null
          total_amount: number | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          document_id: string
          extracted_at?: string
          extracted_data?: Json | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          total_amount?: number | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          document_id?: string
          extracted_at?: string
          extracted_data?: Json | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "site_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_connections: {
        Row: {
          child_meter_id: string
          created_at: string | null
          id: string
          parent_meter_id: string
          updated_at: string | null
        }
        Insert: {
          child_meter_id: string
          created_at?: string | null
          id?: string
          parent_meter_id: string
          updated_at?: string | null
        }
        Update: {
          child_meter_id?: string
          created_at?: string | null
          id?: string
          parent_meter_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meter_connections_child_meter_id_fkey"
            columns: ["child_meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_connections_parent_meter_id_fkey"
            columns: ["parent_meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_csv_files: {
        Row: {
          column_mapping: Json | null
          content_hash: string
          created_at: string
          duplicates_skipped: number | null
          error_message: string | null
          file_name: string
          file_path: string
          file_size: number | null
          header_row_number: number | null
          id: string
          meter_id: string
          parse_errors: number | null
          parse_status: string
          parsed_at: string | null
          parsed_file_path: string | null
          readings_inserted: number | null
          separator: string | null
          site_id: string
          updated_at: string
          upload_status: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          column_mapping?: Json | null
          content_hash: string
          created_at?: string
          duplicates_skipped?: number | null
          error_message?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          header_row_number?: number | null
          id?: string
          meter_id: string
          parse_errors?: number | null
          parse_status?: string
          parsed_at?: string | null
          parsed_file_path?: string | null
          readings_inserted?: number | null
          separator?: string | null
          site_id: string
          updated_at?: string
          upload_status?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          column_mapping?: Json | null
          content_hash?: string
          created_at?: string
          duplicates_skipped?: number | null
          error_message?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          header_row_number?: number | null
          id?: string
          meter_id?: string
          parse_errors?: number | null
          parse_status?: string
          parsed_at?: string | null
          parsed_file_path?: string | null
          readings_inserted?: number | null
          separator?: string | null
          site_id?: string
          updated_at?: string
          upload_status?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meter_csv_files_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_csv_files_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_positions: {
        Row: {
          created_at: string | null
          id: string
          label: string | null
          meter_id: string
          scale_x: number | null
          scale_y: number | null
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
          scale_x?: number | null
          scale_y?: number | null
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
          scale_x?: number | null
          scale_y?: number | null
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
          kva_value: number | null
          kwh_value: number
          metadata: Json | null
          meter_id: string
          reading_timestamp: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          kva_value?: number | null
          kwh_value: number
          metadata?: Json | null
          meter_id: string
          reading_timestamp: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          kva_value?: number | null
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
          area: number | null
          cable_specification: string | null
          confirmation_status: string | null
          created_at: string | null
          ct_ratio: string | null
          ct_type: string | null
          id: string
          is_revenue_critical: boolean | null
          location: string | null
          mccb_size: number | null
          meter_number: string
          meter_type: string
          name: string | null
          phase: string | null
          rating: string | null
          scanned_snippet_url: string | null
          serial_number: string | null
          site_id: string
          supply_description: string | null
          supply_level: string | null
          tariff: string | null
          tariff_structure_id: string | null
          updated_at: string | null
          zone: string | null
        }
        Insert: {
          area?: number | null
          cable_specification?: string | null
          confirmation_status?: string | null
          created_at?: string | null
          ct_ratio?: string | null
          ct_type?: string | null
          id?: string
          is_revenue_critical?: boolean | null
          location?: string | null
          mccb_size?: number | null
          meter_number: string
          meter_type: string
          name?: string | null
          phase?: string | null
          rating?: string | null
          scanned_snippet_url?: string | null
          serial_number?: string | null
          site_id: string
          supply_description?: string | null
          supply_level?: string | null
          tariff?: string | null
          tariff_structure_id?: string | null
          updated_at?: string | null
          zone?: string | null
        }
        Update: {
          area?: number | null
          cable_specification?: string | null
          confirmation_status?: string | null
          created_at?: string | null
          ct_ratio?: string | null
          ct_type?: string | null
          id?: string
          is_revenue_critical?: boolean | null
          location?: string | null
          mccb_size?: number | null
          meter_number?: string
          meter_type?: string
          name?: string | null
          phase?: string | null
          rating?: string | null
          scanned_snippet_url?: string | null
          serial_number?: string | null
          site_id?: string
          supply_description?: string | null
          supply_level?: string | null
          tariff?: string | null
          tariff_structure_id?: string | null
          updated_at?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meters_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meters_tariff_structure_id_fkey"
            columns: ["tariff_structure_id"]
            isOneToOne: false
            referencedRelation: "tariff_structures"
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
      reconciliation_meter_results: {
        Row: {
          assignment: string | null
          column_max_values: Json | null
          column_totals: Json | null
          created_at: string | null
          error_message: string | null
          has_error: boolean | null
          id: string
          location: string | null
          meter_id: string
          meter_name: string | null
          meter_number: string
          meter_type: string
          readings_count: number
          reconciliation_run_id: string
          total_kwh: number
          total_kwh_negative: number
          total_kwh_positive: number
        }
        Insert: {
          assignment?: string | null
          column_max_values?: Json | null
          column_totals?: Json | null
          created_at?: string | null
          error_message?: string | null
          has_error?: boolean | null
          id?: string
          location?: string | null
          meter_id: string
          meter_name?: string | null
          meter_number: string
          meter_type: string
          readings_count?: number
          reconciliation_run_id: string
          total_kwh?: number
          total_kwh_negative?: number
          total_kwh_positive?: number
        }
        Update: {
          assignment?: string | null
          column_max_values?: Json | null
          column_totals?: Json | null
          created_at?: string | null
          error_message?: string | null
          has_error?: boolean | null
          id?: string
          location?: string | null
          meter_id?: string
          meter_name?: string | null
          meter_number?: string
          meter_type?: string
          readings_count?: number
          reconciliation_run_id?: string
          total_kwh?: number
          total_kwh_negative?: number
          total_kwh_positive?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_meter_results_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_meter_results_reconciliation_run_id_fkey"
            columns: ["reconciliation_run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          bulk_total: number
          created_at: string | null
          created_by: string | null
          date_from: string
          date_to: string
          discrepancy: number
          id: string
          notes: string | null
          recovery_rate: number
          run_date: string
          run_name: string
          site_id: string
          solar_total: number
          tenant_total: number
          total_supply: number
          updated_at: string | null
        }
        Insert: {
          bulk_total?: number
          created_at?: string | null
          created_by?: string | null
          date_from: string
          date_to: string
          discrepancy?: number
          id?: string
          notes?: string | null
          recovery_rate?: number
          run_date?: string
          run_name: string
          site_id: string
          solar_total?: number
          tenant_total?: number
          total_supply?: number
          updated_at?: string | null
        }
        Update: {
          bulk_total?: number
          created_at?: string | null
          created_by?: string | null
          date_from?: string
          date_to?: string
          discrepancy?: number
          id?: string
          notes?: string | null
          recovery_rate?: number
          run_date?: string
          run_name?: string
          site_id?: string
          solar_total?: number
          tenant_total?: number
          total_supply?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      schematic_lines: {
        Row: {
          color: string | null
          created_at: string | null
          from_x: number
          from_y: number
          id: string
          line_type: string | null
          metadata: Json | null
          schematic_id: string
          stroke_width: number | null
          to_x: number
          to_y: number
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          from_x: number
          from_y: number
          id?: string
          line_type?: string | null
          metadata?: Json | null
          schematic_id: string
          stroke_width?: number | null
          to_x: number
          to_y: number
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          from_x?: number
          from_y?: number
          id?: string
          line_type?: string | null
          metadata?: Json | null
          schematic_id?: string
          stroke_width?: number | null
          to_x?: number
          to_y?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schematic_lines_schematic_id_fkey"
            columns: ["schematic_id"]
            isOneToOne: false
            referencedRelation: "schematics"
            referencedColumns: ["id"]
          },
        ]
      }
      schematics: {
        Row: {
          converted_image_path: string | null
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
          converted_image_path?: string | null
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
          converted_image_path?: string | null
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
      settings: {
        Row: {
          app_name: string
          created_at: string
          id: string
          logo_url: string | null
          updated_at: string
        }
        Insert: {
          app_name?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          updated_at?: string
        }
        Update: {
          app_name?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_documents: {
        Row: {
          converted_image_path: string | null
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          extraction_status: string
          file_name: string
          file_path: string
          file_size: number | null
          folder_path: string
          id: string
          is_folder: boolean
          parent_folder_id: string | null
          site_id: string
          updated_at: string
          upload_date: string
          uploaded_by: string | null
        }
        Insert: {
          converted_image_path?: string | null
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          extraction_status?: string
          file_name: string
          file_path: string
          file_size?: number | null
          folder_path?: string
          id?: string
          is_folder?: boolean
          parent_folder_id?: string | null
          site_id: string
          updated_at?: string
          upload_date?: string
          uploaded_by?: string | null
        }
        Update: {
          converted_image_path?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          extraction_status?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          folder_path?: string
          id?: string
          is_folder?: boolean
          parent_folder_id?: string | null
          site_id?: string
          updated_at?: string
          upload_date?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_documents_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "site_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_documents_site_id_fkey"
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
          source_document_id: string | null
          supply_authority_id: string
          tariff_type: string
          tou_type: string | null
          transmission_zone: string | null
          updated_at: string | null
          uses_tou: boolean | null
          voltage_level: string | null
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
          source_document_id?: string | null
          supply_authority_id: string
          tariff_type: string
          tou_type?: string | null
          transmission_zone?: string | null
          updated_at?: string | null
          uses_tou?: boolean | null
          voltage_level?: string | null
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
          source_document_id?: string | null
          supply_authority_id?: string
          tariff_type?: string
          tou_type?: string | null
          transmission_zone?: string | null
          updated_at?: string | null
          uses_tou?: boolean | null
          voltage_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_structures_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "site_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_structures_supply_authority_id_fkey"
            columns: ["supply_authority_id"]
            isOneToOne: false
            referencedRelation: "supply_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_time_periods: {
        Row: {
          created_at: string | null
          day_type: string
          end_hour: number
          energy_charge_cents: number
          id: string
          period_type: string
          season: string
          start_hour: number
          tariff_structure_id: string
        }
        Insert: {
          created_at?: string | null
          day_type: string
          end_hour: number
          energy_charge_cents: number
          id?: string
          period_type: string
          season: string
          start_hour: number
          tariff_structure_id: string
        }
        Update: {
          created_at?: string | null
          day_type?: string
          end_hour?: number
          energy_charge_cents?: number
          id?: string
          period_type?: string
          season?: string
          start_hour?: number
          tariff_structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariff_time_periods_tariff_structure_id_fkey"
            columns: ["tariff_structure_id"]
            isOneToOne: false
            referencedRelation: "tariff_structures"
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
      delete_meter_readings_by_ids: {
        Args: { p_meter_ids: string[] }
        Returns: {
          total_deleted: number
        }[]
      }
      delete_schematic_meters: {
        Args: { schematic_uuid: string }
        Returns: {
          deleted_connections: number
          deleted_lines: number
          deleted_meters: number
          deleted_positions: number
          deleted_snippets: number
        }[]
      }
      delete_site_readings: {
        Args: { p_site_id: string }
        Returns: {
          total_deleted: number
        }[]
      }
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
      document_type: "municipal_account" | "tenant_bill" | "other" | "report"
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
      document_type: ["municipal_account", "tenant_bill", "other", "report"],
    },
  },
} as const
