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
      comments: {
        Row: {
          created_at: string
          id: string
          message: string
          project_id: string
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          project_id: string
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          project_id?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          cnpj: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          public_form_token: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnpj: string
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          public_form_token?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnpj?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          public_form_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_kanban_model: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          company_id: string
          id: string
          kanban_model_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          company_id: string
          id?: string
          kanban_model_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          company_id?: string
          id?: string
          kanban_model_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_kanban_model_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kanban_model_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kanban_model_kanban_model_id_fkey"
            columns: ["kanban_model_id"]
            isOneToOne: false
            referencedRelation: "kanban_models"
            referencedColumns: ["id"]
          },
        ]
      }
      concessionaire_documents: {
        Row: {
          concessionaire_id: string
          created_at: string
          file_name: string
          file_path: string
          file_type: string | null
          id: string
          uploaded_by: string | null
        }
        Insert: {
          concessionaire_id: string
          created_at?: string
          file_name: string
          file_path: string
          file_type?: string | null
          id?: string
          uploaded_by?: string | null
        }
        Update: {
          concessionaire_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_type?: string | null
          id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "concessionaire_documents_concessionaire_id_fkey"
            columns: ["concessionaire_id"]
            isOneToOne: false
            referencedRelation: "energy_concessionaires"
            referencedColumns: ["id"]
          },
        ]
      }
      concessionaire_templates: {
        Row: {
          concessionaire_id: string
          created_at: string | null
          file_name: string
          file_path: string
          file_type: string
          id: string
          name: string
          tag_mapping: Json
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          concessionaire_id: string
          created_at?: string | null
          file_name: string
          file_path: string
          file_type: string
          id?: string
          name: string
          tag_mapping?: Json
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          concessionaire_id?: string
          created_at?: string | null
          file_name?: string
          file_path?: string
          file_type?: string
          id?: string
          name?: string
          tag_mapping?: Json
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "concessionaire_templates_concessionaire_id_fkey"
            columns: ["concessionaire_id"]
            isOneToOne: false
            referencedRelation: "energy_concessionaires"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          file_type: string | null
          file_url: string
          id: string
          project_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          file_type?: string | null
          file_url: string
          id?: string
          project_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string
          file_type?: string | null
          file_url?: string
          id?: string
          project_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      energy_concessionaires: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      financial_payments: {
        Row: {
          amount: number
          created_at: string
          financial_id: string
          id: string
          notes: string | null
          payment_date: string
        }
        Insert: {
          amount: number
          created_at?: string
          financial_id: string
          id?: string
          notes?: string | null
          payment_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          financial_id?: string
          id?: string
          notes?: string | null
          payment_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_payments_financial_id_fkey"
            columns: ["financial_id"]
            isOneToOne: false
            referencedRelation: "financials"
            referencedColumns: ["id"]
          },
        ]
      }
      financials: {
        Row: {
          amount_paid: number
          company_id: string
          created_at: string
          due_date: string | null
          id: string
          project_id: string
          project_value: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          company_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          project_id: string
          project_value?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          company_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          project_id?: string
          project_value?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      form_configs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_field_rules: {
        Row: {
          action: Database["public"]["Enums"]["field_action"]
          condition_field_key: string
          condition_operator: Database["public"]["Enums"]["condition_operator"]
          condition_value: string | null
          created_at: string
          field_id: string
          id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["field_action"]
          condition_field_key: string
          condition_operator: Database["public"]["Enums"]["condition_operator"]
          condition_value?: string | null
          created_at?: string
          field_id: string
          id?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["field_action"]
          condition_field_key?: string
          condition_operator?: Database["public"]["Enums"]["condition_operator"]
          condition_value?: string | null
          created_at?: string
          field_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_field_rules_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          created_at: string
          field_group: string | null
          field_key: string
          field_label: string
          field_type: Database["public"]["Enums"]["field_type"]
          form_config_id: string
          helper_text: string | null
          id: string
          is_required: boolean
          is_visible: boolean
          options: Json | null
          order_index: number
          placeholder: string | null
        }
        Insert: {
          created_at?: string
          field_group?: string | null
          field_key: string
          field_label: string
          field_type: Database["public"]["Enums"]["field_type"]
          form_config_id: string
          helper_text?: string | null
          id?: string
          is_required?: boolean
          is_visible?: boolean
          options?: Json | null
          order_index?: number
          placeholder?: string | null
        }
        Update: {
          created_at?: string
          field_group?: string | null
          field_key?: string
          field_label?: string
          field_type?: Database["public"]["Enums"]["field_type"]
          form_config_id?: string
          helper_text?: string | null
          id?: string
          is_required?: boolean
          is_visible?: boolean
          options?: Json | null
          order_index?: number
          placeholder?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_form_config_id_fkey"
            columns: ["form_config_id"]
            isOneToOne: false
            referencedRelation: "form_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_columns: {
        Row: {
          color: string
          created_at: string
          id: string
          is_final: boolean
          is_initial: boolean
          is_rejection_stage: boolean | null
          kanban_model_id: string
          order_index: number
          requires_protocol: boolean
          stale_days: number | null
          status_key: string
          status_label: string
          triggers_revision: boolean | null
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_final?: boolean
          is_initial?: boolean
          is_rejection_stage?: boolean | null
          kanban_model_id: string
          order_index?: number
          requires_protocol?: boolean
          stale_days?: number | null
          status_key: string
          status_label: string
          triggers_revision?: boolean | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_final?: boolean
          is_initial?: boolean
          is_rejection_stage?: boolean | null
          kanban_model_id?: string
          order_index?: number
          requires_protocol?: boolean
          stale_days?: number | null
          status_key?: string
          status_label?: string
          triggers_revision?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "kanban_columns_kanban_model_id_fkey"
            columns: ["kanban_model_id"]
            isOneToOne: false
            referencedRelation: "kanban_models"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_models: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_models_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          message: string
          project_id: string | null
          read: boolean | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          project_id?: string | null
          read?: boolean | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          project_id?: string | null
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_history: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string
          project_id: string
          registered_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date: string
          project_id: string
          registered_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          project_id?: string
          registered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          company_id: string | null
          created_at: string
          email: string
          hide_company_name: boolean | null
          id: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
          staff_access_mode:
            | Database["public"]["Enums"]["staff_access_mode"]
            | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email: string
          hide_company_name?: boolean | null
          id: string
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          staff_access_mode?:
            | Database["public"]["Enums"]["staff_access_mode"]
            | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string
          hide_company_name?: boolean | null
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          staff_access_mode?:
            | Database["public"]["Enums"]["staff_access_mode"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          project_id: string
          staff_user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          project_id: string
          staff_user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          project_id?: string
          staff_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_equipment: {
        Row: {
          created_at: string
          id: string
          inverter_brand: string | null
          inverter_model: string
          inverter_power: number | null
          inverter_quantity: number | null
          module_brand: string | null
          module_model: string | null
          module_power: number | null
          module_quantity: number
          project_id: string
          total_installed_power: number
        }
        Insert: {
          created_at?: string
          id?: string
          inverter_brand?: string | null
          inverter_model: string
          inverter_power?: number | null
          inverter_quantity?: number | null
          module_brand?: string | null
          module_model?: string | null
          module_power?: number | null
          module_quantity: number
          project_id: string
          total_installed_power: number
        }
        Update: {
          created_at?: string
          id?: string
          inverter_brand?: string | null
          inverter_model?: string
          inverter_power?: number | null
          inverter_quantity?: number | null
          module_brand?: string | null
          module_model?: string | null
          module_power?: number | null
          module_quantity?: number
          project_id?: string
          total_installed_power?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_equipment_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_equipment_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_financials: {
        Row: {
          company_id: string | null
          created_at: string
          due_date: string | null
          id: string
          paid_value: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          project_id: string
          project_value: number
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          paid_value?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          project_id: string
          project_value?: number
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          paid_value?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          project_id?: string
          project_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_financials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_financials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_financials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_general_data: {
        Row: {
          address: string
          address_complement?: string | null
          address_number?: string | null
          cep?: string | null
          neighborhood?: string | null
          circuit_breaker_current: string | null
          city: string
          coordinates: string | null
          created_at: string
          has_beneficiaries: boolean
          holder_cpf_cnpj: string
          holder_email: string | null
          holder_name: string
          holder_phone: string | null
          id: string
          is_rural: boolean
          observations: string | null
          phase_type: string | null
          project_id: string
          state: string
          uc_number: string
          utility_company: string
        }
        Insert: {
          address: string
          address_complement?: string | null
          address_number?: string | null
          cep?: string | null
          neighborhood?: string | null
          circuit_breaker_current?: string | null
          city: string
          coordinates?: string | null
          created_at?: string
          has_beneficiaries?: boolean
          holder_cpf_cnpj: string
          holder_email?: string | null
          holder_name: string
          holder_phone?: string | null
          id?: string
          is_rural?: boolean
          observations?: string | null
          phase_type?: string | null
          project_id: string
          state: string
          uc_number: string
          utility_company: string
        }
        Update: {
          address?: string
          address_complement?: string | null
          address_number?: string | null
          cep?: string | null
          neighborhood?: string | null
          circuit_breaker_current?: string | null
          city?: string
          coordinates?: string | null
          created_at?: string
          has_beneficiaries?: boolean
          holder_cpf_cnpj?: string
          holder_email?: string | null
          holder_name?: string
          holder_phone?: string | null
          id?: string
          is_rural?: boolean
          observations?: string | null
          phase_type?: string | null
          project_id?: string
          state?: string
          uc_number?: string
          utility_company?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_general_data_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_general_data_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_history: {
        Row: {
          action: string
          created_at: string
          description: string
          id: string
          project_id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description: string
          id?: string
          project_id: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          id?: string
          project_id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_protocols: {
        Row: {
          id: string
          no_protocol: boolean
          no_protocol_reason: string | null
          project_id: string
          protocol_number: string | null
          registered_at: string | null
          registered_by: string | null
          revision_number: number
        }
        Insert: {
          id?: string
          no_protocol?: boolean
          no_protocol_reason?: string | null
          project_id: string
          protocol_number?: string | null
          registered_at?: string | null
          registered_by?: string | null
          revision_number?: number
        }
        Update: {
          id?: string
          no_protocol?: boolean
          no_protocol_reason?: string | null
          project_id?: string
          protocol_number?: string | null
          registered_at?: string | null
          registered_by?: string | null
          revision_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_protocols_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_protocols_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_revisions: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_current: boolean
          project_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          revision_number: number
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_current?: boolean
          project_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          revision_number?: number
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_current?: boolean
          project_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          revision_number?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_revisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_revisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "stale_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string
          company_id: string
          concessionaire_id: string | null
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          form_config_id: string | null
          id: string
          is_deleted: boolean
          kanban_model_id: string | null
          last_status_change: string | null
          protocol_number: string | null
          source: Database["public"]["Enums"]["project_source"]
          status: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at: string
        }
        Insert: {
          code?: string
          company_id: string
          concessionaire_id?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          form_config_id?: string | null
          id?: string
          is_deleted?: boolean
          kanban_model_id?: string | null
          last_status_change?: string | null
          protocol_number?: string | null
          source?: Database["public"]["Enums"]["project_source"]
          status?: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          concessionaire_id?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          form_config_id?: string | null
          id?: string
          is_deleted?: boolean
          kanban_model_id?: string | null
          last_status_change?: string | null
          protocol_number?: string | null
          source?: Database["public"]["Enums"]["project_source"]
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_concessionaire_id_fkey"
            columns: ["concessionaire_id"]
            isOneToOne: false
            referencedRelation: "energy_concessionaires"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_form_config_id_fkey"
            columns: ["form_config_id"]
            isOneToOne: false
            referencedRelation: "form_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_kanban_model_id_fkey"
            columns: ["kanban_model_id"]
            isOneToOne: false
            referencedRelation: "kanban_models"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_equipment: {
        Row: {
          created_at: string | null
          id: string
          inverter_brand: string | null
          inverter_model: string | null
          inverter_power: number | null
          inverter_quantity: number | null
          module_brand: string | null
          module_model: string | null
          module_power: number | null
          module_quantity: number | null
          revision_id: string
          total_installed_power: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inverter_brand?: string | null
          inverter_model?: string | null
          inverter_power?: number | null
          inverter_quantity?: number | null
          module_brand?: string | null
          module_model?: string | null
          module_power?: number | null
          module_quantity?: number | null
          revision_id: string
          total_installed_power?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inverter_brand?: string | null
          inverter_model?: string | null
          inverter_power?: number | null
          inverter_quantity?: number | null
          module_brand?: string | null
          module_model?: string | null
          module_power?: number | null
          module_quantity?: number | null
          revision_id?: string
          total_installed_power?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "revision_equipment_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "project_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_general_data: {
        Row: {
          address: string | null
          address_complement?: string | null
          address_number?: string | null
          neighborhood?: string | null
          cep: string | null
          circuit_breaker_current: string | null
          city: string | null
          coordinates: string | null
          created_at: string | null
          holder_cpf_cnpj: string | null
          holder_email: string | null
          holder_name: string | null
          holder_phone: string | null
          id: string
          is_rural: boolean | null
          phase_type: string | null
          revision_id: string
          state: string | null
          uc_number: string | null
          utility_company: string | null
        }
        Insert: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          neighborhood?: string | null
          cep?: string | null
          circuit_breaker_current?: string | null
          city?: string | null
          coordinates?: string | null
          created_at?: string | null
          holder_cpf_cnpj?: string | null
          holder_email?: string | null
          holder_name?: string | null
          holder_phone?: string | null
          id?: string
          is_rural?: boolean | null
          phase_type?: string | null
          revision_id: string
          state?: string | null
          uc_number?: string | null
          utility_company?: string | null
        }
        Update: {
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          neighborhood?: string | null
          cep?: string | null
          circuit_breaker_current?: string | null
          city?: string | null
          coordinates?: string | null
          created_at?: string | null
          holder_cpf_cnpj?: string | null
          holder_email?: string | null
          holder_name?: string | null
          holder_phone?: string | null
          id?: string
          is_rural?: boolean | null
          phase_type?: string | null
          revision_id?: string
          state?: string | null
          uc_number?: string | null
          utility_company?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revision_general_data_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "project_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_checklists: {
        Row: {
          created_at: string | null
          custom_items: string[] | null
          enabled: boolean | null
          from_status: string
          id: string
          required_documents: string[] | null
          to_status: string
        }
        Insert: {
          created_at?: string | null
          custom_items?: string[] | null
          enabled?: boolean | null
          from_status: string
          id?: string
          required_documents?: string[] | null
          to_status: string
        }
        Update: {
          created_at?: string | null
          custom_items?: string[] | null
          enabled?: boolean | null
          from_status?: string
          id?: string
          required_documents?: string[] | null
          to_status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      stale_projects: {
        Row: {
          code: string | null
          column_id: string | null
          company_id: string | null
          days_stale: number | null
          id: string | null
          last_status_change: string | null
          stale_days: number | null
          status: string | null
          status_label: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_company_by_public_token: {
        Args: { _token: string }
        Returns: {
          id: string
          name: string
          public_form_token: string
        }[]
      }
      get_company_id_by_token: { Args: { _token: string }; Returns: string }
      get_company_kanban_model_id: {
        Args: { _company_id: string }
        Returns: string
      }
      get_kanban_columns: {
        Args: { _model_id: string }
        Returns: {
          color: string
          id: string
          is_final: boolean
          is_initial: boolean
          order_index: number
          status_key: string
          status_label: string
        }[]
      }
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
      should_hide_company_name: { Args: { _user_id: string }; Returns: boolean }
      soft_delete_project: {
        Args: { _project_id: string; _reason: string }
        Returns: boolean
      }
      staff_can_access_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      condition_operator:
        | "equals"
        | "not_equals"
        | "contains"
        | "is_checked"
        | "is_not_checked"
        | "is_empty"
        | "is_not_empty"
      document_type:
        | "energy_bill_generator"
        | "energy_bill_beneficiaries"
        | "holder_document"
        | "entrance_standard_photo"
        | "breaker_photo"
        | "other_photos"
        | "cnpj_card"
        | "social_contract"
        | "legal_rep_document"
        | "power_of_attorney"
        | "extra_attachment"
      field_action: "show" | "hide" | "require" | "optional"
      field_type:
        | "text"
        | "number"
        | "email"
        | "phone"
        | "cpf"
        | "cnpj"
        | "cep"
        | "select"
        | "radio"
        | "checkbox"
        | "textarea"
        | "file"
        | "date"
      payment_status: "pending" | "partial" | "paid"
      project_source: "company_login" | "public_form" | "admin"
      project_status:
        | "pending"
        | "analysis"
        | "documentation"
        | "approval"
        | "approved"
        | "completed"
        | "pendencia"
        | "vistoria_solicitada"
        | "aguardando_instalacao"
        | "vistoria_sem_protocolo"
        | "vistoria_reprovada"
      staff_access_mode: "global" | "assigned_only"
      user_role: "admin" | "staff" | "company"
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
      condition_operator: [
        "equals",
        "not_equals",
        "contains",
        "is_checked",
        "is_not_checked",
        "is_empty",
        "is_not_empty",
      ],
      document_type: [
        "energy_bill_generator",
        "energy_bill_beneficiaries",
        "holder_document",
        "entrance_standard_photo",
        "breaker_photo",
        "other_photos",
        "cnpj_card",
        "social_contract",
        "legal_rep_document",
        "power_of_attorney",
        "extra_attachment",
      ],
      field_action: ["show", "hide", "require", "optional"],
      field_type: [
        "text",
        "number",
        "email",
        "phone",
        "cpf",
        "cnpj",
        "cep",
        "select",
        "radio",
        "checkbox",
        "textarea",
        "file",
        "date",
      ],
      payment_status: ["pending", "partial", "paid"],
      project_source: ["company_login", "public_form", "admin"],
      project_status: [
        "pending",
        "analysis",
        "documentation",
        "approval",
        "approved",
        "completed",
        "pendencia",
        "vistoria_solicitada",
        "aguardando_instalacao",
        "vistoria_sem_protocolo",
        "vistoria_reprovada",
      ],
      staff_access_mode: ["global", "assigned_only"],
      user_role: ["admin", "staff", "company"],
    },
  },
} as const
