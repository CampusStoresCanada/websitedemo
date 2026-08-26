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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      _prisma_migrations: {
        Row: {
          applied_steps_count: number
          checksum: string
          finished_at: string | null
          id: string
          logs: string | null
          migration_name: string
          rolled_back_at: string | null
          started_at: string
        }
        Insert: {
          applied_steps_count?: number
          checksum: string
          finished_at?: string | null
          id: string
          logs?: string | null
          migration_name: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Update: {
          applied_steps_count?: number
          checksum?: string
          finished_at?: string | null
          id?: string
          logs?: string | null
          migration_name?: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Relationships: []
      }
      activities: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          is_public: boolean
          metadata: Json
          occurred_at: string
          organization_id: string | null
          person_id: string
          score: number | null
          source: string
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id: string
          is_public?: boolean
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          person_id: string
          score?: number | null
          source: string
          tenant_id: string
          type: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_public?: boolean
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          person_id?: string
          score?: number | null
          source?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_transfer_requests: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          from_user_id: string
          id: string
          metadata: Json | null
          organization_id: string
          reason: string | null
          requested_at: string
          status: string
          timeout_at: string
          to_user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          from_user_id: string
          id?: string
          metadata?: Json | null
          organization_id: string
          reason?: string | null
          requested_at?: string
          status?: string
          timeout_at: string
          to_user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          from_user_id?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          reason?: string | null
          requested_at?: string
          status?: string
          timeout_at?: string
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_transfer_requests_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_transfer_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_transfer_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_transfer_requests_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string | null
          description: string | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          automation_mode: string
          created_at: string
          enabled: boolean
          id: string
          label: string
          rule_key: string
          template_key: string
          updated_at: string
        }
        Insert: {
          automation_mode: string
          created_at?: string
          enabled?: boolean
          id?: string
          label: string
          rule_key: string
          template_key: string
          updated_at?: string
        }
        Update: {
          automation_mode?: string
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          rule_key?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      badge_print_events: {
        Row: {
          actor_id: string | null
          conference_id: string
          created_at: string
          event_status: string
          event_type: string
          id: string
          job_id: string
          message: string | null
          payload: Json
          person_id: string | null
        }
        Insert: {
          actor_id?: string | null
          conference_id: string
          created_at?: string
          event_status?: string
          event_type: string
          id?: string
          job_id: string
          message?: string | null
          payload?: Json
          person_id?: string | null
        }
        Update: {
          actor_id?: string | null
          conference_id?: string
          created_at?: string
          event_status?: string
          event_type?: string
          id?: string
          job_id?: string
          message?: string | null
          payload?: Json
          person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "badge_print_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_print_events_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_print_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "badge_print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_print_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_print_jobs: {
        Row: {
          batch_order_direction: string | null
          batch_order_mode: string | null
          completed_at: string | null
          conference_id: string
          created_at: string
          id: string
          initiated_by: string | null
          metadata: Json
          output_artifact_url: string | null
          person_id: string | null
          pipeline_type: string
          printer_bridge_state: string
          reprint_note: string | null
          reprint_reason: string | null
          started_at: string | null
          status: string
          template_version: number | null
          transport_method: string
          updated_at: string
        }
        Insert: {
          batch_order_direction?: string | null
          batch_order_mode?: string | null
          completed_at?: string | null
          conference_id: string
          created_at?: string
          id?: string
          initiated_by?: string | null
          metadata?: Json
          output_artifact_url?: string | null
          person_id?: string | null
          pipeline_type: string
          printer_bridge_state?: string
          reprint_note?: string | null
          reprint_reason?: string | null
          started_at?: string | null
          status: string
          template_version?: number | null
          transport_method?: string
          updated_at?: string
        }
        Update: {
          batch_order_direction?: string | null
          batch_order_mode?: string | null
          completed_at?: string | null
          conference_id?: string
          created_at?: string
          id?: string
          initiated_by?: string | null
          metadata?: Json
          output_artifact_url?: string | null
          person_id?: string | null
          pipeline_type?: string
          printer_bridge_state?: string
          reprint_note?: string | null
          reprint_reason?: string | null
          started_at?: string | null
          status?: string
          template_version?: number | null
          transport_method?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "badge_print_jobs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_print_jobs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_print_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_setup_sessions: {
        Row: {
          conference_id: string
          id: string
          last_step: number
          state_json: Json
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          conference_id: string
          id?: string
          last_step?: number
          state_json?: Json
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          conference_id?: string
          id?: string
          last_step?: number
          state_json?: Json
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "badge_setup_sessions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: true
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_setup_sessions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_template_configs: {
        Row: {
          conference_id: string
          config_version: number
          created_at: string
          created_by: string | null
          field_mapping: Json
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          conference_id: string
          config_version: number
          created_at?: string
          created_by?: string | null
          field_mapping?: Json
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          conference_id?: string
          config_version?: number
          created_at?: string
          created_by?: string | null
          field_mapping?: Json
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "badge_template_configs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_template_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarking: {
        Row: {
          adoption_deadline_window: string | null
          adoptions_by_deadline: number | null
          amended_at: string | null
          central_funding: number | null
          cm_course_packs_online: number | null
          cm_course_packs_total: number | null
          cm_custom_courseware_online: number | null
          cm_custom_courseware_total: number | null
          cm_digital_online: number | null
          cm_digital_total: number | null
          cm_inclusive_access_online: number | null
          cm_inclusive_access_total: number | null
          cm_other_online: number | null
          cm_other_total: number | null
          cm_print_new_online: number | null
          cm_print_new_total: number | null
          cm_print_used_online: number | null
          cm_print_used_total: number | null
          cm_rentals_online: number | null
          cm_rentals_total: number | null
          computers_online_only: boolean | null
          contributions_to_campus: string[] | null
          created_at: string | null
          custom_imprint_online_only: boolean | null
          disclosure_level: string
          disclosure_level_set_at: string | null
          disclosure_level_set_by: string | null
          ebook_delivery_system: string | null
          enrollment_fte: number | null
          expense_hr: number | null
          expense_rent_maintenance: number | null
          fiscal_year: number
          fiscal_year_end_date: string | null
          fulltime_employees: number | null
          fye_inventory_value: number | null
          has_webstore: boolean | null
          hours_vary_seasonally: boolean | null
          ia_revenue: number | null
          id: string
          institution_type: string | null
          is_semester_based: boolean | null
          lms_system: string | null
          manager_years_current_position: number | null
          manager_years_in_industry: number | null
          marketing_spend: number | null
          net_profit: number | null
          non_textbook_online_percentage: number | null
          num_store_locations: number | null
          online_store_integrated: boolean | null
          operations_mandate: string | null
          organization_id: string
          other_non_retail_description: string | null
          other_non_retail_revenue: number | null
          other_online_only: string | null
          parttime_fte_offpeak: number | null
          payment_options: string[] | null
          physical_inventory_schedule: string[] | null
          pos_runs_inventory: boolean | null
          pos_system: string | null
          respondent_email: string | null
          respondent_name: string | null
          respondent_phone: string | null
          respondent_title: string | null
          respondent_user_id: string | null
          sales_apparel: number | null
          sales_apparel_imprint: number | null
          sales_apparel_non_imprint: number | null
          sales_course_materials: number | null
          sales_course_materials_online: number | null
          sales_course_supplies: number | null
          sales_course_supplies_online: number | null
          sales_custom_merch: number | null
          sales_food_beverage: number | null
          sales_general_books: number | null
          sales_gifts_drinkware: number | null
          sales_gifts_imprint: number | null
          sales_gifts_non_imprint: number | null
          sales_stationary: number | null
          sales_technology: number | null
          saturday_hours_close: string | null
          saturday_hours_open: string | null
          services_offered: string[] | null
          shopping_services: string[] | null
          shrink_general_merch: number | null
          shrink_percentage: number | null
          shrink_textbooks: number | null
          social_media_frequency: string | null
          social_media_platforms: string[] | null
          social_media_run_by: string | null
          special_charges_notes: string | null
          sqft_office: number | null
          sqft_other: number | null
          sqft_salesfloor: number | null
          sqft_storage: number | null
          status: string | null
          store_in_stores: string[] | null
          store_name: string | null
          student_fte_average: number | null
          student_info_system: string | null
          submitted_at: string | null
          sunday_hours_close: string | null
          sunday_hours_open: string | null
          textbooks_online_only: boolean | null
          total_cogs: number | null
          total_course_sections: number | null
          total_gross_sales_instore: number | null
          total_online_sales: number | null
          total_square_footage: number | null
          total_transaction_count: number | null
          tracks_adoptions: boolean | null
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
          visibility: string | null
          weekday_hours_close: string | null
          weekday_hours_open: string | null
        }
        Insert: {
          adoption_deadline_window?: string | null
          adoptions_by_deadline?: number | null
          amended_at?: string | null
          central_funding?: number | null
          cm_course_packs_online?: number | null
          cm_course_packs_total?: number | null
          cm_custom_courseware_online?: number | null
          cm_custom_courseware_total?: number | null
          cm_digital_online?: number | null
          cm_digital_total?: number | null
          cm_inclusive_access_online?: number | null
          cm_inclusive_access_total?: number | null
          cm_other_online?: number | null
          cm_other_total?: number | null
          cm_print_new_online?: number | null
          cm_print_new_total?: number | null
          cm_print_used_online?: number | null
          cm_print_used_total?: number | null
          cm_rentals_online?: number | null
          cm_rentals_total?: number | null
          computers_online_only?: boolean | null
          contributions_to_campus?: string[] | null
          created_at?: string | null
          custom_imprint_online_only?: boolean | null
          disclosure_level?: string
          disclosure_level_set_at?: string | null
          disclosure_level_set_by?: string | null
          ebook_delivery_system?: string | null
          enrollment_fte?: number | null
          expense_hr?: number | null
          expense_rent_maintenance?: number | null
          fiscal_year: number
          fiscal_year_end_date?: string | null
          fulltime_employees?: number | null
          fye_inventory_value?: number | null
          has_webstore?: boolean | null
          hours_vary_seasonally?: boolean | null
          ia_revenue?: number | null
          id?: string
          institution_type?: string | null
          is_semester_based?: boolean | null
          lms_system?: string | null
          manager_years_current_position?: number | null
          manager_years_in_industry?: number | null
          marketing_spend?: number | null
          net_profit?: number | null
          non_textbook_online_percentage?: number | null
          num_store_locations?: number | null
          online_store_integrated?: boolean | null
          operations_mandate?: string | null
          organization_id: string
          other_non_retail_description?: string | null
          other_non_retail_revenue?: number | null
          other_online_only?: string | null
          parttime_fte_offpeak?: number | null
          payment_options?: string[] | null
          physical_inventory_schedule?: string[] | null
          pos_runs_inventory?: boolean | null
          pos_system?: string | null
          respondent_email?: string | null
          respondent_name?: string | null
          respondent_phone?: string | null
          respondent_title?: string | null
          respondent_user_id?: string | null
          sales_apparel?: number | null
          sales_apparel_imprint?: number | null
          sales_apparel_non_imprint?: number | null
          sales_course_materials?: number | null
          sales_course_materials_online?: number | null
          sales_course_supplies?: number | null
          sales_course_supplies_online?: number | null
          sales_custom_merch?: number | null
          sales_food_beverage?: number | null
          sales_general_books?: number | null
          sales_gifts_drinkware?: number | null
          sales_gifts_imprint?: number | null
          sales_gifts_non_imprint?: number | null
          sales_stationary?: number | null
          sales_technology?: number | null
          saturday_hours_close?: string | null
          saturday_hours_open?: string | null
          services_offered?: string[] | null
          shopping_services?: string[] | null
          shrink_general_merch?: number | null
          shrink_percentage?: number | null
          shrink_textbooks?: number | null
          social_media_frequency?: string | null
          social_media_platforms?: string[] | null
          social_media_run_by?: string | null
          special_charges_notes?: string | null
          sqft_office?: number | null
          sqft_other?: number | null
          sqft_salesfloor?: number | null
          sqft_storage?: number | null
          status?: string | null
          store_in_stores?: string[] | null
          store_name?: string | null
          student_fte_average?: number | null
          student_info_system?: string | null
          submitted_at?: string | null
          sunday_hours_close?: string | null
          sunday_hours_open?: string | null
          textbooks_online_only?: boolean | null
          total_cogs?: number | null
          total_course_sections?: number | null
          total_gross_sales_instore?: number | null
          total_online_sales?: number | null
          total_square_footage?: number | null
          total_transaction_count?: number | null
          tracks_adoptions?: boolean | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          visibility?: string | null
          weekday_hours_close?: string | null
          weekday_hours_open?: string | null
        }
        Update: {
          adoption_deadline_window?: string | null
          adoptions_by_deadline?: number | null
          amended_at?: string | null
          central_funding?: number | null
          cm_course_packs_online?: number | null
          cm_course_packs_total?: number | null
          cm_custom_courseware_online?: number | null
          cm_custom_courseware_total?: number | null
          cm_digital_online?: number | null
          cm_digital_total?: number | null
          cm_inclusive_access_online?: number | null
          cm_inclusive_access_total?: number | null
          cm_other_online?: number | null
          cm_other_total?: number | null
          cm_print_new_online?: number | null
          cm_print_new_total?: number | null
          cm_print_used_online?: number | null
          cm_print_used_total?: number | null
          cm_rentals_online?: number | null
          cm_rentals_total?: number | null
          computers_online_only?: boolean | null
          contributions_to_campus?: string[] | null
          created_at?: string | null
          custom_imprint_online_only?: boolean | null
          disclosure_level?: string
          disclosure_level_set_at?: string | null
          disclosure_level_set_by?: string | null
          ebook_delivery_system?: string | null
          enrollment_fte?: number | null
          expense_hr?: number | null
          expense_rent_maintenance?: number | null
          fiscal_year?: number
          fiscal_year_end_date?: string | null
          fulltime_employees?: number | null
          fye_inventory_value?: number | null
          has_webstore?: boolean | null
          hours_vary_seasonally?: boolean | null
          ia_revenue?: number | null
          id?: string
          institution_type?: string | null
          is_semester_based?: boolean | null
          lms_system?: string | null
          manager_years_current_position?: number | null
          manager_years_in_industry?: number | null
          marketing_spend?: number | null
          net_profit?: number | null
          non_textbook_online_percentage?: number | null
          num_store_locations?: number | null
          online_store_integrated?: boolean | null
          operations_mandate?: string | null
          organization_id?: string
          other_non_retail_description?: string | null
          other_non_retail_revenue?: number | null
          other_online_only?: string | null
          parttime_fte_offpeak?: number | null
          payment_options?: string[] | null
          physical_inventory_schedule?: string[] | null
          pos_runs_inventory?: boolean | null
          pos_system?: string | null
          respondent_email?: string | null
          respondent_name?: string | null
          respondent_phone?: string | null
          respondent_title?: string | null
          respondent_user_id?: string | null
          sales_apparel?: number | null
          sales_apparel_imprint?: number | null
          sales_apparel_non_imprint?: number | null
          sales_course_materials?: number | null
          sales_course_materials_online?: number | null
          sales_course_supplies?: number | null
          sales_course_supplies_online?: number | null
          sales_custom_merch?: number | null
          sales_food_beverage?: number | null
          sales_general_books?: number | null
          sales_gifts_drinkware?: number | null
          sales_gifts_imprint?: number | null
          sales_gifts_non_imprint?: number | null
          sales_stationary?: number | null
          sales_technology?: number | null
          saturday_hours_close?: string | null
          saturday_hours_open?: string | null
          services_offered?: string[] | null
          shopping_services?: string[] | null
          shrink_general_merch?: number | null
          shrink_percentage?: number | null
          shrink_textbooks?: number | null
          social_media_frequency?: string | null
          social_media_platforms?: string[] | null
          social_media_run_by?: string | null
          special_charges_notes?: string | null
          sqft_office?: number | null
          sqft_other?: number | null
          sqft_salesfloor?: number | null
          sqft_storage?: number | null
          status?: string | null
          store_in_stores?: string[] | null
          store_name?: string | null
          student_fte_average?: number | null
          student_info_system?: string | null
          submitted_at?: string | null
          sunday_hours_close?: string | null
          sunday_hours_open?: string | null
          textbooks_online_only?: boolean | null
          total_cogs?: number | null
          total_course_sections?: number | null
          total_gross_sales_instore?: number | null
          total_online_sales?: number | null
          total_square_footage?: number | null
          total_transaction_count?: number | null
          tracks_adoptions?: boolean | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          visibility?: string | null
          weekday_hours_close?: string | null
          weekday_hours_open?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benchmarking_disclosure_level_set_by_fkey"
            columns: ["disclosure_level_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_respondent_user_id_fkey"
            columns: ["respondent_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarking_field_reviews: {
        Row: {
          comment: string | null
          created_at: string
          field_name: string
          id: string
          proposed_example: string | null
          proposed_example_credit: string | null
          proposed_help_text: string | null
          resolution: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          reviewer_id: string
          status: string
          survey_id: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          field_name: string
          id?: string
          proposed_example?: string | null
          proposed_example_credit?: string | null
          proposed_help_text?: string | null
          resolution?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          reviewer_id: string
          status?: string
          survey_id: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          field_name?: string
          id?: string
          proposed_example?: string | null
          proposed_example_credit?: string | null
          proposed_help_text?: string | null
          resolution?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          reviewer_id?: string
          status?: string
          survey_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmarking_field_reviews_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_field_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_field_reviews_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "benchmarking_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarking_notes: {
        Row: {
          author_id: string
          created_at: string
          delta_flag_id: string | null
          field_name: string
          id: string
          note: string
          organization_id: string
          override_at: string | null
          override_by: string | null
          override_reason: string | null
          published_on_override: boolean
          respondent_at: string | null
          respondent_decision: string | null
          respondent_id: string | null
          secretary_at: string | null
          secretary_decision: string | null
          secretary_id: string | null
          status: string
          survey_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          created_at?: string
          delta_flag_id?: string | null
          field_name: string
          id?: string
          note: string
          organization_id: string
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          published_on_override?: boolean
          respondent_at?: string | null
          respondent_decision?: string | null
          respondent_id?: string | null
          secretary_at?: string | null
          secretary_decision?: string | null
          secretary_id?: string | null
          status?: string
          survey_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          delta_flag_id?: string | null
          field_name?: string
          id?: string
          note?: string
          organization_id?: string
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          published_on_override?: boolean
          respondent_at?: string | null
          respondent_decision?: string | null
          respondent_id?: string | null
          secretary_at?: string | null
          secretary_decision?: string | null
          secretary_id?: string | null
          status?: string
          survey_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmarking_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_delta_flag_id_fkey"
            columns: ["delta_flag_id"]
            isOneToOne: false
            referencedRelation: "delta_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_respondent_id_fkey"
            columns: ["respondent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_secretary_id_fkey"
            columns: ["secretary_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_notes_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "benchmarking_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarking_recipients: {
        Row: {
          assigned_to: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          contact_id: string | null
          created_at: string
          id: string
          invited_at: string | null
          is_beta: boolean
          last_send_error: string | null
          note: string | null
          organization_id: string
          reminded_at: string | null
          reminder_count: number
          status: string
          survey_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          invited_at?: string | null
          is_beta?: boolean
          last_send_error?: string | null
          note?: string | null
          organization_id: string
          reminded_at?: string | null
          reminder_count?: number
          status?: string
          survey_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          invited_at?: string | null
          is_beta?: boolean
          last_send_error?: string | null
          note?: string | null
          organization_id?: string
          reminded_at?: string | null
          reminder_count?: number
          status?: string
          survey_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmarking_recipients_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_recipients_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "benchmarking_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarking_report_access: {
        Row: {
          id: string
          named_peer_count: number
          recipient_organization_id: string
          survey_fiscal_year: number
          viewed_at: string
          viewed_by: string | null
        }
        Insert: {
          id?: string
          named_peer_count?: number
          recipient_organization_id: string
          survey_fiscal_year: number
          viewed_at?: string
          viewed_by?: string | null
        }
        Update: {
          id?: string
          named_peer_count?: number
          recipient_organization_id?: string
          survey_fiscal_year?: number
          viewed_at?: string
          viewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benchmarking_report_access_recipient_organization_id_fkey"
            columns: ["recipient_organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_report_access_recipient_organization_id_fkey"
            columns: ["recipient_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmarking_report_access_viewed_by_fkey"
            columns: ["viewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarking_surveys: {
        Row: {
          closes_at: string | null
          created_at: string | null
          created_by: string | null
          field_config: Json | null
          fiscal_year: number
          id: string
          opens_at: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          closes_at?: string | null
          created_at?: string | null
          created_by?: string | null
          field_config?: Json | null
          fiscal_year: number
          id?: string
          opens_at?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          closes_at?: string | null
          created_at?: string | null
          created_by?: string | null
          field_config?: Json | null
          fiscal_year?: number
          id?: string
          opens_at?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benchmarking_surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_runs: {
        Row: {
          completed_at: string | null
          conference_id: string
          failed_items: number | null
          id: string
          metadata: Json | null
          started_at: string | null
          status: string
          successful_items: number | null
          total_items: number | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          conference_id: string
          failed_items?: number | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          status?: string
          successful_items?: number | null
          total_items?: number | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          conference_id?: string
          failed_items?: number | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          status?: string
          successful_items?: number | null
          total_items?: number | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_runs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_action_item_updates: {
        Row: {
          author_id: string | null
          created_at: string
          id: string
          item_id: string
          note: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          id?: string
          item_id: string
          note: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          id?: string
          item_id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_action_item_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_action_item_updates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "board_action_items"
            referencedColumns: ["id"]
          },
        ]
      }
      board_action_items: {
        Row: {
          assigned_to: string | null
          assignees: string[]
          complete_token: string
          created_at: string
          description: string
          dropped_at: string | null
          dropped_reason: string | null
          due_date: string | null
          due_date_original: string | null
          escalated_at: string | null
          held_at: string | null
          id: string
          meeting_id: string
          pre_meeting_reminder_sent_at: string | null
          priority: string | null
          quality_flags: string[]
          recurrence: string | null
          reminder_sent_at: string | null
          series_id: string | null
          sort_order: number
          source: string
          source_excerpt: string | null
          started_at: string | null
          status: string
          title: string
        }
        Insert: {
          assigned_to?: string | null
          assignees?: string[]
          complete_token?: string
          created_at?: string
          description: string
          dropped_at?: string | null
          dropped_reason?: string | null
          due_date?: string | null
          due_date_original?: string | null
          escalated_at?: string | null
          held_at?: string | null
          id?: string
          meeting_id: string
          pre_meeting_reminder_sent_at?: string | null
          priority?: string | null
          quality_flags?: string[]
          recurrence?: string | null
          reminder_sent_at?: string | null
          series_id?: string | null
          sort_order?: number
          source?: string
          source_excerpt?: string | null
          started_at?: string | null
          status?: string
          title: string
        }
        Update: {
          assigned_to?: string | null
          assignees?: string[]
          complete_token?: string
          created_at?: string
          description?: string
          dropped_at?: string | null
          dropped_reason?: string | null
          due_date?: string | null
          due_date_original?: string | null
          escalated_at?: string | null
          held_at?: string | null
          id?: string
          meeting_id?: string
          pre_meeting_reminder_sent_at?: string | null
          priority?: string | null
          quality_flags?: string[]
          recurrence?: string | null
          reminder_sent_at?: string | null
          series_id?: string | null
          sort_order?: number
          source?: string
          source_excerpt?: string | null
          started_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_action_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "board_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      board_documents: {
        Row: {
          context: string
          created_at: string
          document_type: string
          file_size_bytes: number | null
          id: string
          meeting_id: string | null
          mime_type: string | null
          onedrive_item_id: string | null
          onedrive_path: string | null
          storage_path: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          visible_from: string | null
        }
        Insert: {
          context?: string
          created_at?: string
          document_type?: string
          file_size_bytes?: number | null
          id?: string
          meeting_id?: string | null
          mime_type?: string | null
          onedrive_item_id?: string | null
          onedrive_path?: string | null
          storage_path?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          visible_from?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          document_type?: string
          file_size_bytes?: number | null
          id?: string
          meeting_id?: string | null
          mime_type?: string | null
          onedrive_item_id?: string | null
          onedrive_path?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          visible_from?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_documents_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "board_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_meetings: {
        Row: {
          agenda_html: string | null
          agenda_updated_at: string | null
          created_at: string
          created_by: string | null
          event_id: string | null
          id: string
          meeting_date: string
          meeting_type: string
          minutes_html: string | null
          minutes_updated_at: string | null
          notes: string | null
          notion_page_id: string | null
          notion_page_url: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agenda_html?: string | null
          agenda_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          meeting_date: string
          meeting_type?: string
          minutes_html?: string | null
          minutes_updated_at?: string | null
          notes?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agenda_html?: string | null
          agenda_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          meeting_date?: string
          meeting_type?: string
          minutes_html?: string | null
          minutes_updated_at?: string | null
          notes?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_meetings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_meetings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      board_qbo_snapshots: {
        Row: {
          approved_by: string | null
          data_json: Json
          id: string
          meeting_id: string | null
          period_end_date: string
          pulled_at: string
          report_type: string
        }
        Insert: {
          approved_by?: string | null
          data_json: Json
          id?: string
          meeting_id?: string | null
          period_end_date: string
          pulled_at?: string
          report_type: string
        }
        Update: {
          approved_by?: string | null
          data_json?: Json
          id?: string
          meeting_id?: string | null
          period_end_date?: string
          pulled_at?: string
          report_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_qbo_snapshots_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_qbo_snapshots_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "board_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      board_vote_ballots: {
        Row: {
          cast_at: string
          changed_at: string | null
          choice: string
          director_profile_id: string
          id: string
          source: string
          vote_id: string
        }
        Insert: {
          cast_at?: string
          changed_at?: string | null
          choice: string
          director_profile_id: string
          id?: string
          source?: string
          vote_id: string
        }
        Update: {
          cast_at?: string
          changed_at?: string | null
          choice?: string
          director_profile_id?: string
          id?: string
          source?: string
          vote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_vote_ballots_director_profile_id_fkey"
            columns: ["director_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_vote_ballots_vote_id_fkey"
            columns: ["vote_id"]
            isOneToOne: false
            referencedRelation: "board_votes"
            referencedColumns: ["id"]
          },
        ]
      }
      board_votes: {
        Row: {
          application_id: string
          board_size: number
          circle_post_id: number | null
          circle_post_url: string | null
          closes_at: string
          created_at: string
          decided_at: string | null
          executed_at: string | null
          executed_by: string | null
          id: string
          opened_at: string
          public_token: string
          reminder_sent_at: string | null
          status: string
          threshold: number
          updated_at: string
        }
        Insert: {
          application_id: string
          board_size?: number
          circle_post_id?: number | null
          circle_post_url?: string | null
          closes_at: string
          created_at?: string
          decided_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          opened_at?: string
          public_token: string
          reminder_sent_at?: string | null
          status?: string
          threshold?: number
          updated_at?: string
        }
        Update: {
          application_id?: string
          board_size?: number
          circle_post_id?: number | null
          circle_post_url?: string | null
          closes_at?: string
          created_at?: string
          decided_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          opened_at?: string
          public_token?: string
          reminder_sent_at?: string | null
          status?: string
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_votes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "signup_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_votes_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_colors: {
        Row: {
          cmyk_c: number | null
          cmyk_k: number | null
          cmyk_m: number | null
          cmyk_y: number | null
          created_at: string | null
          hex: string | null
          id: string
          name: string | null
          organization_id: string
          pantone: string | null
          rgb_b: number | null
          rgb_g: number | null
          rgb_r: number | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          cmyk_c?: number | null
          cmyk_k?: number | null
          cmyk_m?: number | null
          cmyk_y?: number | null
          created_at?: string | null
          hex?: string | null
          id?: string
          name?: string | null
          organization_id: string
          pantone?: string | null
          rgb_b?: number | null
          rgb_g?: number | null
          rgb_r?: number | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          cmyk_c?: number | null
          cmyk_k?: number | null
          cmyk_m?: number | null
          cmyk_y?: number | null
          created_at?: string | null
          hex?: string | null
          id?: string
          name?: string | null
          organization_id?: string
          pantone?: string | null
          rgb_b?: number | null
          rgb_g?: number | null
          rgb_r?: number | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_colors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_colors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_item_notes: {
        Row: {
          actor_id: string | null
          calendar_item_id: string
          created_at: string
          id: string
          note: string
        }
        Insert: {
          actor_id?: string | null
          calendar_item_id: string
          created_at?: string
          id?: string
          note: string
        }
        Update: {
          actor_id?: string | null
          calendar_item_id?: string
          created_at?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_item_notes_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_item_notes_calendar_item_id_fkey"
            columns: ["calendar_item_id"]
            isOneToOne: false
            referencedRelation: "calendar_items"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_items: {
        Row: {
          category: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          layer: string
          metadata: Json
          owner_id: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          requires_confirmation: boolean
          severity: string
          source_key: string | null
          source_mode: string
          starts_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          layer: string
          metadata?: Json
          owner_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          requires_confirmation?: boolean
          severity?: string
          source_key?: string | null
          source_mode?: string
          starts_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          layer?: string
          metadata?: Json
          owner_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          requires_confirmation?: boolean
          severity?: string
          source_key?: string | null
          source_mode?: string
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_items_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_delegates: {
        Row: {
          child_capability: string
          parent_capability: string
        }
        Insert: {
          child_capability: string
          parent_capability: string
        }
        Update: {
          child_capability?: string
          parent_capability?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          conference_id: string
          created_at: string
          expires_at: string | null
          id: string
          metadata: Json | null
          offer_entity_id: string | null
          organization_id: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          offer_entity_id?: string | null
          organization_id: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          offer_entity_id?: string | null
          organization_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_offer_entity_id_fkey"
            columns: ["offer_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_event_rsvp_cache: {
        Row: {
          circle_attendee_id: number | null
          circle_event_id: number
          circle_member_id: number
          event_id: string | null
          id: string
          member_name: string | null
          reconciled: boolean
          rsvp_status: string
          supabase_user_id: string | null
          synced_at: string
        }
        Insert: {
          circle_attendee_id?: number | null
          circle_event_id: number
          circle_member_id: number
          event_id?: string | null
          id?: string
          member_name?: string | null
          reconciled?: boolean
          rsvp_status?: string
          supabase_user_id?: string | null
          synced_at?: string
        }
        Update: {
          circle_attendee_id?: number | null
          circle_event_id?: number
          circle_member_id?: number
          event_id?: string | null
          id?: string
          member_name?: string | null
          reconciled?: boolean
          rsvp_status?: string
          supabase_user_id?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_event_rsvp_cache_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_event_rsvp_cache_supabase_user_id_fkey"
            columns: ["supabase_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_member_mapping: {
        Row: {
          circle_member_id: number
          circle_public_uid: string | null
          contact_id: string | null
          created_at: string
          id: string
          match_confidence: string
          match_method: string
          notes: string | null
          supabase_user_id: string | null
          updated_at: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          circle_member_id: number
          circle_public_uid?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          match_confidence?: string
          match_method?: string
          notes?: string | null
          supabase_user_id?: string | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          circle_member_id?: number
          circle_public_uid?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          match_confidence?: string
          match_method?: string
          notes?: string | null
          supabase_user_id?: string | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "circle_member_mapping_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_member_mapping_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_member_mapping_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_member_mapping_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_sync_queue: {
        Row: {
          attempts: number
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          max_attempts: number
          next_retry_at: string | null
          operation: string
          payload: Json
          processed_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          operation: string
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          operation?: string
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      comms_campaign_milestones: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
          occurred_at: string
          template_id: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          occurred_at?: string
          template_id?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          occurred_at?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comms_campaign_milestones_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comms_campaign_totals"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "comms_campaign_milestones_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comms_campaign_milestones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comms_campaign_milestones_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      comms_campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          goal: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["comms_initiative_status"]
          target_condition_keys: string[]
          target_condition_match: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          goal?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["comms_initiative_status"]
          target_condition_keys?: string[]
          target_condition_match?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          goal?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["comms_initiative_status"]
          target_condition_keys?: string[]
          target_condition_match?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comms_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comms_conditions: {
        Row: {
          created_at: string
          created_by: string | null
          field: string
          id: string
          key: string
          label: string
          operator: string
          reference_id: string | null
          subject: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field: string
          id?: string
          key: string
          label: string
          operator: string
          reference_id?: string | null
          subject: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field?: string
          id?: string
          key?: string
          label?: string
          operator?: string
          reference_id?: string | null
          subject?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comms_conditions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comms_suppressions: {
        Row: {
          category: string
          created_at: string
          email: string
          id: string
          reason: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          email: string
          id?: string
          reason?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          email?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      computed_metrics: {
        Row: {
          adoption_completion_rate: number | null
          avg_transaction_value: number | null
          benchmarking_id: string
          cm_sales_per_fte: number | null
          computed_at: string | null
          fiscal_year: number
          gmroi: number | null
          gross_margin: number | null
          gross_margin_pct: number | null
          hr_pct: number | null
          id: string
          inventory_turns: number | null
          net_margin_pct: number | null
          online_pct: number | null
          organization_id: string
          region: string | null
          sales_per_fte: number | null
          sales_per_sqft: number | null
          sales_tier: string | null
          size_tier: string | null
          total_retail_revenue: number | null
          total_revenue: number | null
          yoy_gross_margin_pct_delta: number | null
          yoy_hr_pct_delta: number | null
          yoy_net_margin_pct_delta: number | null
          yoy_online_pct_delta: number | null
          yoy_sales_per_fte_delta: number | null
          yoy_sales_per_sqft_delta: number | null
          yoy_total_revenue_delta: number | null
        }
        Insert: {
          adoption_completion_rate?: number | null
          avg_transaction_value?: number | null
          benchmarking_id: string
          cm_sales_per_fte?: number | null
          computed_at?: string | null
          fiscal_year: number
          gmroi?: number | null
          gross_margin?: number | null
          gross_margin_pct?: number | null
          hr_pct?: number | null
          id?: string
          inventory_turns?: number | null
          net_margin_pct?: number | null
          online_pct?: number | null
          organization_id: string
          region?: string | null
          sales_per_fte?: number | null
          sales_per_sqft?: number | null
          sales_tier?: string | null
          size_tier?: string | null
          total_retail_revenue?: number | null
          total_revenue?: number | null
          yoy_gross_margin_pct_delta?: number | null
          yoy_hr_pct_delta?: number | null
          yoy_net_margin_pct_delta?: number | null
          yoy_online_pct_delta?: number | null
          yoy_sales_per_fte_delta?: number | null
          yoy_sales_per_sqft_delta?: number | null
          yoy_total_revenue_delta?: number | null
        }
        Update: {
          adoption_completion_rate?: number | null
          avg_transaction_value?: number | null
          benchmarking_id?: string
          cm_sales_per_fte?: number | null
          computed_at?: string | null
          fiscal_year?: number
          gmroi?: number | null
          gross_margin?: number | null
          gross_margin_pct?: number | null
          hr_pct?: number | null
          id?: string
          inventory_turns?: number | null
          net_margin_pct?: number | null
          online_pct?: number | null
          organization_id?: string
          region?: string | null
          sales_per_fte?: number | null
          sales_per_sqft?: number | null
          sales_tier?: string | null
          size_tier?: string | null
          total_retail_revenue?: number | null
          total_revenue?: number | null
          yoy_gross_margin_pct_delta?: number | null
          yoy_hr_pct_delta?: number | null
          yoy_net_margin_pct_delta?: number | null
          yoy_online_pct_delta?: number | null
          yoy_sales_per_fte_delta?: number | null
          yoy_sales_per_sqft_delta?: number | null
          yoy_total_revenue_delta?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "computed_metrics_benchmarking_id_fkey"
            columns: ["benchmarking_id"]
            isOneToOne: true
            referencedRelation: "benchmarking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "computed_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "computed_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_badge_tokens: {
        Row: {
          conference_id: string
          created_at: string
          created_by: string | null
          id: string
          person_id: string
          revoked_at: string | null
          revoked_by: string | null
          token_format: string
          token_hash: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          person_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_format?: string
          token_hash: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          person_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_format?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_badge_tokens_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_badge_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_badge_tokens_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_badge_tokens_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_booth_moves: {
        Row: {
          actor_id: string | null
          conference_id: string
          created_at: string
          delta_cents: number
          id: string
          new_booth_entity_ids: string[]
          new_order_id: string | null
          new_total_cents: number
          old_booth_entity_ids: string[]
          old_total_cents: number
          organization_id: string
          reason: string | null
          refund_ids: string[]
        }
        Insert: {
          actor_id?: string | null
          conference_id: string
          created_at?: string
          delta_cents: number
          id?: string
          new_booth_entity_ids: string[]
          new_order_id?: string | null
          new_total_cents: number
          old_booth_entity_ids: string[]
          old_total_cents: number
          organization_id: string
          reason?: string | null
          refund_ids?: string[]
        }
        Update: {
          actor_id?: string | null
          conference_id?: string
          created_at?: string
          delta_cents?: number
          id?: string
          new_booth_entity_ids?: string[]
          new_order_id?: string | null
          new_total_cents?: number
          old_booth_entity_ids?: string[]
          old_total_cents?: number
          organization_id?: string
          reason?: string | null
          refund_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "conference_booth_moves_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_booth_moves_new_order_id_fkey"
            columns: ["new_order_id"]
            isOneToOne: false
            referencedRelation: "conference_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_booth_moves_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_booth_moves_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_bursary_applications: {
        Row: {
          conference_id: string
          contact_email: string
          contact_name: string
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          status: string
          submitted_by_user_id: string | null
          updated_at: string
        }
        Insert: {
          conference_id: string
          contact_email: string
          contact_name: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          status?: string
          submitted_by_user_id?: string | null
          updated_at?: string
        }
        Update: {
          conference_id?: string
          contact_email?: string
          contact_name?: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          status?: string
          submitted_by_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_bursary_applications_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_bursary_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_bursary_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_check_in_events: {
        Row: {
          check_in_source: string
          checked_in_at: string
          checked_in_by: string | null
          conference_id: string
          created_at: string
          device_id: string | null
          id: string
          person_id: string | null
          result_state: string
          scan_token_id: string | null
        }
        Insert: {
          check_in_source: string
          checked_in_at?: string
          checked_in_by?: string | null
          conference_id: string
          created_at?: string
          device_id?: string | null
          id?: string
          person_id?: string | null
          result_state: string
          scan_token_id?: string | null
        }
        Update: {
          check_in_source?: string
          checked_in_at?: string
          checked_in_by?: string | null
          conference_id?: string
          created_at?: string
          device_id?: string | null
          id?: string
          person_id?: string | null
          result_state?: string
          scan_token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conference_check_in_events_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_check_in_events_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_check_in_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_check_in_events_scan_token_id_fkey"
            columns: ["scan_token_id"]
            isOneToOne: false
            referencedRelation: "conference_badge_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_checklist_checkpoints: {
        Row: {
          checklist_id: string
          created_at: string
          days_before_deadline: number
          id: string
        }
        Insert: {
          checklist_id: string
          created_at?: string
          days_before_deadline: number
          id?: string
        }
        Update: {
          checklist_id?: string
          created_at?: string
          days_before_deadline?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_checklist_checkpoints_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "conference_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_checklist_reminder_log: {
        Row: {
          checklist_id: string
          checkpoint_id: string
          id: string
          organization_id: string
          sent_at: string
        }
        Insert: {
          checklist_id: string
          checkpoint_id: string
          id?: string
          organization_id: string
          sent_at?: string
        }
        Update: {
          checklist_id?: string
          checkpoint_id?: string
          id?: string
          organization_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_checklist_reminder_log_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "conference_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checklist_reminder_log_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "conference_checklist_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checklist_reminder_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checklist_reminder_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_checklist_tasks: {
        Row: {
          active: boolean
          audience: string
          check_entity_id: string | null
          check_type: string
          checklist_id: string
          created_at: string
          description: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience?: string
          check_entity_id?: string | null
          check_type: string
          checklist_id: string
          created_at?: string
          description: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: string
          check_entity_id?: string | null
          check_type?: string
          checklist_id?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_checklist_tasks_check_entity_id_fkey"
            columns: ["check_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checklist_tasks_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "conference_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_checklists: {
        Row: {
          active: boolean
          conference_id: string
          created_at: string
          deadline_at: string
          description: string | null
          id: string
          name: string
          publication_id: string | null
          scope_entity_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          conference_id: string
          created_at?: string
          deadline_at: string
          description?: string | null
          id?: string
          name: string
          publication_id?: string | null
          scope_entity_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          conference_id?: string
          created_at?: string
          deadline_at?: string
          description?: string | null
          id?: string
          name?: string
          publication_id?: string | null
          scope_entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_checklists_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checklists_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_checklists_scope_entity_id_fkey"
            columns: ["scope_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_days: {
        Row: {
          conference_id: string
          created_at: string
          date: string
          day_profile: string
          id: string
          label: string | null
          sort: number
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          date: string
          day_profile?: string
          id?: string
          label?: string | null
          sort?: number
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          date?: string
          day_profile?: string
          id?: string
          label?: string | null
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_days_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_entities: {
        Row: {
          attributes: Json
          conference_id: string
          created_at: string
          currency: string
          id: string
          inventory: number | null
          is_for_sale: boolean
          kind: string
          name: string
          needs_definition: boolean
          price_cents: number | null
          qbo_item_id: string | null
          sales_window: string | null
          tier_prices: Json
          updated_at: string
        }
        Insert: {
          attributes?: Json
          conference_id: string
          created_at?: string
          currency?: string
          id?: string
          inventory?: number | null
          is_for_sale?: boolean
          kind: string
          name: string
          needs_definition?: boolean
          price_cents?: number | null
          qbo_item_id?: string | null
          sales_window?: string | null
          tier_prices?: Json
          updated_at?: string
        }
        Update: {
          attributes?: Json
          conference_id?: string
          created_at?: string
          currency?: string
          id?: string
          inventory?: number | null
          is_for_sale?: boolean
          kind?: string
          name?: string
          needs_definition?: boolean
          price_cents?: number | null
          qbo_item_id?: string | null
          sales_window?: string | null
          tier_prices?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_entities_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_entity_refs: {
        Row: {
          conference_id: string
          created_at: string
          from_entity_id: string
          id: string
          quantity: number | null
          role: string
          to_entity_id: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          from_entity_id: string
          id?: string
          quantity?: number | null
          role: string
          to_entity_id: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          from_entity_id?: string
          id?: string
          quantity?: number | null
          role?: string
          to_entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_entity_refs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_entity_refs_from_entity_id_fkey"
            columns: ["from_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_entity_refs_to_entity_id_fkey"
            columns: ["to_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_entity_usage_intents: {
        Row: {
          conference_id: string
          created_at: string
          declared_against_total: number
          declared_by: string | null
          entity_id: string
          id: string
          intended_quantity: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          declared_against_total?: number
          declared_by?: string | null
          entity_id: string
          id?: string
          intended_quantity: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          declared_against_total?: number
          declared_by?: string | null
          entity_id?: string
          id?: string
          intended_quantity?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_entity_usage_intents_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_entity_usage_intents_declared_by_fkey"
            columns: ["declared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_entity_usage_intents_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_entity_usage_intents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_entity_usage_intents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_instances: {
        Row: {
          board_decision_at: string | null
          booth_sales_general_open_at: string | null
          booth_sales_sponsor_open_at: string | null
          bursary_goal_cents: number | null
          cart_reservation_minutes: number
          created_at: string
          created_by: string | null
          documents: Json
          duplicated_from_id: string | null
          edition_code: string
          end_date: string | null
          floor_plan_url: string | null
          hotel_booking_cutoff: string | null
          hotel_booking_url: string | null
          hotel_note: string | null
          hotel_rates: Json
          id: string
          location_city: string | null
          location_latitude: number | null
          location_longitude: number | null
          location_province: string | null
          location_venue: string | null
          name: string
          on_sale_at: string | null
          qbo_tax_code_ref: string | null
          registration_close_at: string | null
          registration_open_at: string | null
          start_date: string | null
          status: string
          stripe_tax_rate_id: string | null
          tax_jurisdiction: string | null
          tax_rate_pct: number | null
          timezone: string
          updated_at: string
          year: number
        }
        Insert: {
          board_decision_at?: string | null
          booth_sales_general_open_at?: string | null
          booth_sales_sponsor_open_at?: string | null
          bursary_goal_cents?: number | null
          cart_reservation_minutes?: number
          created_at?: string
          created_by?: string | null
          documents?: Json
          duplicated_from_id?: string | null
          edition_code?: string
          end_date?: string | null
          floor_plan_url?: string | null
          hotel_booking_cutoff?: string | null
          hotel_booking_url?: string | null
          hotel_note?: string | null
          hotel_rates?: Json
          id?: string
          location_city?: string | null
          location_latitude?: number | null
          location_longitude?: number | null
          location_province?: string | null
          location_venue?: string | null
          name: string
          on_sale_at?: string | null
          qbo_tax_code_ref?: string | null
          registration_close_at?: string | null
          registration_open_at?: string | null
          start_date?: string | null
          status?: string
          stripe_tax_rate_id?: string | null
          tax_jurisdiction?: string | null
          tax_rate_pct?: number | null
          timezone?: string
          updated_at?: string
          year: number
        }
        Update: {
          board_decision_at?: string | null
          booth_sales_general_open_at?: string | null
          booth_sales_sponsor_open_at?: string | null
          bursary_goal_cents?: number | null
          cart_reservation_minutes?: number
          created_at?: string
          created_by?: string | null
          documents?: Json
          duplicated_from_id?: string | null
          edition_code?: string
          end_date?: string | null
          floor_plan_url?: string | null
          hotel_booking_cutoff?: string | null
          hotel_booking_url?: string | null
          hotel_note?: string | null
          hotel_rates?: Json
          id?: string
          location_city?: string | null
          location_latitude?: number | null
          location_longitude?: number | null
          location_province?: string | null
          location_venue?: string | null
          name?: string
          on_sale_at?: string | null
          qbo_tax_code_ref?: string | null
          registration_close_at?: string | null
          registration_open_at?: string | null
          start_date?: string | null
          status?: string
          stripe_tax_rate_id?: string | null
          tax_jurisdiction?: string | null
          tax_rate_pct?: number | null
          timezone?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_instances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_instances_duplicated_from_id_fkey"
            columns: ["duplicated_from_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_legal_versions: {
        Row: {
          conference_id: string
          content: string
          created_at: string
          created_by: string | null
          document_type: string
          effective_at: string
          id: string
          policy_entity_id: string | null
          version: number
        }
        Insert: {
          conference_id: string
          content: string
          created_at?: string
          created_by?: string | null
          document_type: string
          effective_at: string
          id?: string
          policy_entity_id?: string | null
          version: number
        }
        Update: {
          conference_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          document_type?: string
          effective_at?: string
          id?: string
          policy_entity_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_legal_versions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_legal_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_legal_versions_policy_entity_id_fkey"
            columns: ["policy_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_order_items: {
        Row: {
          id: string
          metadata: Json | null
          offer_entity_id: string | null
          order_id: string
          quantity: number
          tax_cents: number
          total_cents: number
          unit_price_cents: number
        }
        Insert: {
          id?: string
          metadata?: Json | null
          offer_entity_id?: string | null
          order_id: string
          quantity: number
          tax_cents: number
          total_cents: number
          unit_price_cents: number
        }
        Update: {
          id?: string
          metadata?: Json | null
          offer_entity_id?: string | null
          order_id?: string
          quantity?: number
          tax_cents?: number
          total_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_order_items_offer_entity_id_fkey"
            columns: ["offer_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "conference_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_orders: {
        Row: {
          checkout_idempotency_key: string | null
          conference_id: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          paid_at: string | null
          refund_amount_cents: number | null
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          user_id: string
        }
        Insert: {
          checkout_idempotency_key?: string | null
          conference_id: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          invoice_id?: string | null
          organization_id: string
          paid_at?: string | null
          refund_amount_cents?: number | null
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          user_id: string
        }
        Update: {
          checkout_idempotency_key?: string | null
          conference_id?: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          paid_at?: string | null
          refund_amount_cents?: number | null
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_orders_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_people: {
        Row: {
          accessibility_needs: string | null
          admin_notes: string | null
          arrival_flight_details: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_email_snapshot: string | null
          assignment_cutoff_at: string | null
          assignment_status: string
          badge_print_status: string
          badge_printed_at: string | null
          badge_reprint_count: number
          canonical_person_id: string | null
          check_in_source: string | null
          checked_in_at: string | null
          conference_id: string
          conference_staff_id: string | null
          contact_email: string | null
          contact_id: string | null
          created_at: string
          data_quality_flags: string[]
          departure_flight_details: string | null
          dietary_restrictions: string | null
          display_name: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          hotel_confirmation_code: string | null
          hotel_name: string | null
          id: string
          legal_name: string | null
          mobile_phone: string | null
          organization_id: string
          person_kind: string
          preferred_departure_airport: string | null
          reassigned_from_user_id: string | null
          registration_id: string | null
          registration_tier: string | null
          retention_sensitive_fields: string[]
          road_origin_address: string | null
          role_title: string | null
          schedule_registration_id: string | null
          schedule_run_id: string | null
          schedule_scope: string
          seat_index: number | null
          seat_preference: string | null
          source_id: string
          source_type: string
          travel_import_row_ref: string | null
          travel_import_run_id: string | null
          travel_mode: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accessibility_needs?: string | null
          admin_notes?: string | null
          arrival_flight_details?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_email_snapshot?: string | null
          assignment_cutoff_at?: string | null
          assignment_status?: string
          badge_print_status?: string
          badge_printed_at?: string | null
          badge_reprint_count?: number
          canonical_person_id?: string | null
          check_in_source?: string | null
          checked_in_at?: string | null
          conference_id: string
          conference_staff_id?: string | null
          contact_email?: string | null
          contact_id?: string | null
          created_at?: string
          data_quality_flags?: string[]
          departure_flight_details?: string | null
          dietary_restrictions?: string | null
          display_name?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          hotel_confirmation_code?: string | null
          hotel_name?: string | null
          id?: string
          legal_name?: string | null
          mobile_phone?: string | null
          organization_id: string
          person_kind: string
          preferred_departure_airport?: string | null
          reassigned_from_user_id?: string | null
          registration_id?: string | null
          registration_tier?: string | null
          retention_sensitive_fields?: string[]
          road_origin_address?: string | null
          role_title?: string | null
          schedule_registration_id?: string | null
          schedule_run_id?: string | null
          schedule_scope?: string
          seat_index?: number | null
          seat_preference?: string | null
          source_id: string
          source_type: string
          travel_import_row_ref?: string | null
          travel_import_run_id?: string | null
          travel_mode?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accessibility_needs?: string | null
          admin_notes?: string | null
          arrival_flight_details?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_email_snapshot?: string | null
          assignment_cutoff_at?: string | null
          assignment_status?: string
          badge_print_status?: string
          badge_printed_at?: string | null
          badge_reprint_count?: number
          canonical_person_id?: string | null
          check_in_source?: string | null
          checked_in_at?: string | null
          conference_id?: string
          conference_staff_id?: string | null
          contact_email?: string | null
          contact_id?: string | null
          created_at?: string
          data_quality_flags?: string[]
          departure_flight_details?: string | null
          dietary_restrictions?: string | null
          display_name?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          hotel_confirmation_code?: string | null
          hotel_name?: string | null
          id?: string
          legal_name?: string | null
          mobile_phone?: string | null
          organization_id?: string
          person_kind?: string
          preferred_departure_airport?: string | null
          reassigned_from_user_id?: string | null
          registration_id?: string | null
          registration_tier?: string | null
          retention_sensitive_fields?: string[]
          road_origin_address?: string | null
          role_title?: string | null
          schedule_registration_id?: string | null
          schedule_run_id?: string | null
          schedule_scope?: string
          seat_index?: number | null
          seat_preference?: string | null
          source_id?: string
          source_type?: string
          travel_import_row_ref?: string | null
          travel_import_run_id?: string | null
          travel_mode?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conference_people_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_conference_staff_id_fkey"
            columns: ["conference_staff_id"]
            isOneToOne: false
            referencedRelation: "conference_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_reassigned_from_user_id_fkey"
            columns: ["reassigned_from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_schedule_registration_id_fkey"
            columns: ["schedule_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_schedule_run_id_fkey"
            columns: ["schedule_run_id"]
            isOneToOne: false
            referencedRelation: "scheduler_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_registrations: {
        Row: {
          accessibility_needs: string | null
          admin_notes: string | null
          advance_needs: string | null
          arrival_flight_details: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_email_snapshot: string | null
          assignment_cutoff_at: string | null
          assignment_status: string
          badge_organization_id: string | null
          badge_print_status: string
          badge_printed_at: string | null
          badge_reprint_count: number
          blackout_list: string[] | null
          buying_cycles_targeted: string[] | null
          buying_timeline: string[] | null
          category_responsibilities: string[] | null
          check_in_source: string | null
          checked_in_at: string | null
          conference_id: string
          created_at: string
          data_quality_flags: string[]
          date_of_birth: string | null
          delegate_email: string | null
          delegate_name: string | null
          delegate_title: string | null
          delegate_work_phone: string | null
          departure_flight_details: string | null
          dietary_restrictions: string | null
          differentiator: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          functional_roles: string[] | null
          gender: string | null
          hotel_confirmation_code: string | null
          hotel_name: string | null
          id: string
          legal_name: string | null
          linked_registration_id: string | null
          meeting_intent: string[] | null
          meeting_outcome_intent: string[] | null
          meeting_structure: string | null
          mobile_phone: string | null
          nexus_trusted_traveler: boolean | null
          one_thing_to_remember: string | null
          organization_id: string
          preferred_departure_airport: string | null
          primary_category: string | null
          purchasing_authority: string | null
          reassigned_from_user_id: string | null
          registration_custom_answers: Json
          registration_type: string
          road_origin_address: string | null
          sales_readiness: Json | null
          seat_preference: string | null
          secondary_categories: string[] | null
          status: string
          success_definition: string | null
          top_5_preferences: string[] | null
          top_priorities: string[] | null
          travel_consent_given: boolean | null
          travel_import_row_ref: string | null
          travel_import_run_id: string | null
          travel_mode: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accessibility_needs?: string | null
          admin_notes?: string | null
          advance_needs?: string | null
          arrival_flight_details?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_email_snapshot?: string | null
          assignment_cutoff_at?: string | null
          assignment_status?: string
          badge_organization_id?: string | null
          badge_print_status?: string
          badge_printed_at?: string | null
          badge_reprint_count?: number
          blackout_list?: string[] | null
          buying_cycles_targeted?: string[] | null
          buying_timeline?: string[] | null
          category_responsibilities?: string[] | null
          check_in_source?: string | null
          checked_in_at?: string | null
          conference_id: string
          created_at?: string
          data_quality_flags?: string[]
          date_of_birth?: string | null
          delegate_email?: string | null
          delegate_name?: string | null
          delegate_title?: string | null
          delegate_work_phone?: string | null
          departure_flight_details?: string | null
          dietary_restrictions?: string | null
          differentiator?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          functional_roles?: string[] | null
          gender?: string | null
          hotel_confirmation_code?: string | null
          hotel_name?: string | null
          id?: string
          legal_name?: string | null
          linked_registration_id?: string | null
          meeting_intent?: string[] | null
          meeting_outcome_intent?: string[] | null
          meeting_structure?: string | null
          mobile_phone?: string | null
          nexus_trusted_traveler?: boolean | null
          one_thing_to_remember?: string | null
          organization_id: string
          preferred_departure_airport?: string | null
          primary_category?: string | null
          purchasing_authority?: string | null
          reassigned_from_user_id?: string | null
          registration_custom_answers?: Json
          registration_type: string
          road_origin_address?: string | null
          sales_readiness?: Json | null
          seat_preference?: string | null
          secondary_categories?: string[] | null
          status?: string
          success_definition?: string | null
          top_5_preferences?: string[] | null
          top_priorities?: string[] | null
          travel_consent_given?: boolean | null
          travel_import_row_ref?: string | null
          travel_import_run_id?: string | null
          travel_mode?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accessibility_needs?: string | null
          admin_notes?: string | null
          advance_needs?: string | null
          arrival_flight_details?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_email_snapshot?: string | null
          assignment_cutoff_at?: string | null
          assignment_status?: string
          badge_organization_id?: string | null
          badge_print_status?: string
          badge_printed_at?: string | null
          badge_reprint_count?: number
          blackout_list?: string[] | null
          buying_cycles_targeted?: string[] | null
          buying_timeline?: string[] | null
          category_responsibilities?: string[] | null
          check_in_source?: string | null
          checked_in_at?: string | null
          conference_id?: string
          created_at?: string
          data_quality_flags?: string[]
          date_of_birth?: string | null
          delegate_email?: string | null
          delegate_name?: string | null
          delegate_title?: string | null
          delegate_work_phone?: string | null
          departure_flight_details?: string | null
          dietary_restrictions?: string | null
          differentiator?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          functional_roles?: string[] | null
          gender?: string | null
          hotel_confirmation_code?: string | null
          hotel_name?: string | null
          id?: string
          legal_name?: string | null
          linked_registration_id?: string | null
          meeting_intent?: string[] | null
          meeting_outcome_intent?: string[] | null
          meeting_structure?: string | null
          mobile_phone?: string | null
          nexus_trusted_traveler?: boolean | null
          one_thing_to_remember?: string | null
          organization_id?: string
          preferred_departure_airport?: string | null
          primary_category?: string | null
          purchasing_authority?: string | null
          reassigned_from_user_id?: string | null
          registration_custom_answers?: Json
          registration_type?: string
          road_origin_address?: string | null
          sales_readiness?: Json | null
          seat_preference?: string | null
          secondary_categories?: string[] | null
          status?: string
          success_definition?: string | null
          top_5_preferences?: string[] | null
          top_priorities?: string[] | null
          travel_consent_given?: boolean | null
          travel_import_row_ref?: string | null
          travel_import_run_id?: string | null
          travel_mode?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_registrations_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_badge_organization_id_fkey"
            columns: ["badge_organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_badge_organization_id_fkey"
            columns: ["badge_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_linked_registration_id_fkey"
            columns: ["linked_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_reassigned_from_user_id_fkey"
            columns: ["reassigned_from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_schedule_modules: {
        Row: {
          conference_id: string
          config_json: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          module_key: string
          updated_at: string
        }
        Insert: {
          conference_id: string
          config_json?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          module_key: string
          updated_at?: string
        }
        Update: {
          conference_id?: string
          config_json?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          module_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_schedule_modules_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_schedule_modules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_scheduled_transitions: {
        Row: {
          canceled_at: string | null
          canceled_by: string | null
          conference_id: string
          created_at: string
          created_by: string | null
          error: string | null
          executed_at: string | null
          id: string
          run_at: string
          status: string
          target_status: string
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          canceled_by?: string | null
          conference_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          executed_at?: string | null
          id?: string
          run_at: string
          status?: string
          target_status: string
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          canceled_by?: string | null
          conference_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          executed_at?: string | null
          id?: string
          run_at?: string
          status?: string
          target_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_scheduled_transitions_canceled_by_fkey"
            columns: ["canceled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_scheduled_transitions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_scheduled_transitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_staff: {
        Row: {
          accommodation_type: string | null
          badge_organization_id: string | null
          conference_id: string
          created_at: string
          email: string
          extracurricular_registered: boolean | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          registration_id: string
          user_id: string | null
        }
        Insert: {
          accommodation_type?: string | null
          badge_organization_id?: string | null
          conference_id: string
          created_at?: string
          email: string
          extracurricular_registered?: boolean | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          registration_id: string
          user_id?: string | null
        }
        Update: {
          accommodation_type?: string | null
          badge_organization_id?: string | null
          conference_id?: string
          created_at?: string
          email?: string
          extracurricular_registered?: boolean | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          registration_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conference_staff_badge_organization_id_fkey"
            columns: ["badge_organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_badge_organization_id_fkey"
            columns: ["badge_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_suites: {
        Row: {
          conference_id: string
          created_at: string
          entity_id: string | null
          id: string
          is_active: boolean
          suite_number: number
        }
        Insert: {
          conference_id: string
          created_at?: string
          entity_id?: string | null
          id?: string
          is_active?: boolean
          suite_number: number
        }
        Update: {
          conference_id?: string
          created_at?: string
          entity_id?: string | null
          id?: string
          is_active?: boolean
          suite_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_suites_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_suites_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_task_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string | null
          conference_id: string
          created_at: string
          evidence: string | null
          id: string
          note: string | null
          organization_id: string
          person_id: string | null
          state: string
          task_id: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          conference_id: string
          created_at?: string
          evidence?: string | null
          id?: string
          note?: string | null
          organization_id: string
          person_id?: string | null
          state: string
          task_id: string
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          conference_id?: string
          created_at?: string
          evidence?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          person_id?: string | null
          state?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_task_acknowledgements_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_task_acknowledgements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_task_acknowledgements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_task_acknowledgements_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_task_acknowledgements_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "conference_checklist_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_webhook_events: {
        Row: {
          conference_order_id: string | null
          error_message: string | null
          event_type: string
          processed_at: string
          stripe_event_id: string
          success: boolean
        }
        Insert: {
          conference_order_id?: string | null
          error_message?: string | null
          event_type: string
          processed_at?: string
          stripe_event_id: string
          success?: boolean
        }
        Update: {
          conference_order_id?: string | null
          error_message?: string | null
          event_type?: string
          processed_at?: string
          stripe_event_id?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "conference_webhook_events_conference_order_id_fkey"
            columns: ["conference_order_id"]
            isOneToOne: false
            referencedRelation: "conference_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_inquiries: {
        Row: {
          created_at: string
          email: string
          id: string
          is_idn: boolean
          message: string
          name: string
          organization: string | null
          status: string
          subject: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_idn?: boolean
          message: string
          name: string
          organization?: string | null
          status?: string
          subject: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_idn?: boolean
          message?: string
          name?: string
          organization?: string | null
          status?: string
          subject?: string
          user_id?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          archived_at: string | null
          circle_id: string | null
          circle_properties: Json | null
          conference_order_id: string | null
          contact_type: string[] | null
          created_at: string | null
          dietary_restrictions: string | null
          directory_visibility: string | null
          directory_visibility_asked_at: string | null
          directory_visibility_set_at: string | null
          email: string | null
          first_name: string | null
          hidden: boolean
          id: string
          is_primary: boolean
          last_contact_date: string | null
          last_edited_time: string | null
          last_name: string | null
          metadata: Json | null
          name: string
          notes: string | null
          notion_id: string | null
          notion_properties: Json | null
          organization_id: string | null
          personal_tag_ids: string[] | null
          phone: string | null
          profile_id: string | null
          profile_picture_url: string | null
          role_title: string | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          tenant_id: string | null
          updated_at: string | null
          vcard: string | null
          vcard_url: string | null
          work_email: string | null
          work_phone_number: string | null
        }
        Insert: {
          archived_at?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          conference_order_id?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          dietary_restrictions?: string | null
          directory_visibility?: string | null
          directory_visibility_asked_at?: string | null
          directory_visibility_set_at?: string | null
          email?: string | null
          first_name?: string | null
          hidden?: boolean
          id?: string
          is_primary?: boolean
          last_contact_date?: string | null
          last_edited_time?: string | null
          last_name?: string | null
          metadata?: Json | null
          name: string
          notes?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          organization_id?: string | null
          personal_tag_ids?: string[] | null
          phone?: string | null
          profile_id?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vcard?: string | null
          vcard_url?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Update: {
          archived_at?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          conference_order_id?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          dietary_restrictions?: string | null
          directory_visibility?: string | null
          directory_visibility_asked_at?: string | null
          directory_visibility_set_at?: string | null
          email?: string | null
          first_name?: string | null
          hidden?: boolean
          id?: string
          is_primary?: boolean
          last_contact_date?: string | null
          last_edited_time?: string | null
          last_name?: string | null
          metadata?: Json | null
          name?: string
          notes?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          organization_id?: string | null
          personal_tag_ids?: string[] | null
          phone?: string | null
          profile_id?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vcard?: string | null
          vcard_url?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_change_tokens: {
        Row: {
          change_id: string
          created_at: string
          expires_at: string
          id: string
          intended_for: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          change_id: string
          created_at?: string
          expires_at: string
          id?: string
          intended_for: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          change_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          intended_for?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_change_tokens_change_id_fkey"
            columns: ["change_id"]
            isOneToOne: false
            referencedRelation: "pending_content_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_change_tokens_intended_for_fkey"
            columns: ["intended_for"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_flags: {
        Row: {
          created_at: string | null
          field_name: string
          flagged_by: string
          id: string
          organization_id: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string | null
          field_name: string
          flagged_by: string
          id?: string
          organization_id: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string | null
          field_name?: string
          flagged_by?: string
          id?: string
          organization_id?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_widget_config: {
        Row: {
          config_json: Json | null
          display_order: number
          enabled: boolean
          id: string
          role: string
          updated_at: string
          updated_by: string | null
          widget_key: string
        }
        Insert: {
          config_json?: Json | null
          display_order?: number
          enabled?: boolean
          id?: string
          role: string
          updated_at?: string
          updated_by?: string | null
          widget_key: string
        }
        Update: {
          config_json?: Json | null
          display_order?: number
          enabled?: boolean
          id?: string
          role?: string
          updated_at?: string
          updated_by?: string | null
          widget_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widget_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delta_flags: {
        Row: {
          abs_change: number | null
          benchmarking_id: string
          committee_notes: string | null
          committee_status: string | null
          created_at: string | null
          current_value: number | null
          field_name: string
          id: string
          pct_change: number | null
          previous_value: number | null
          respondent_action: string | null
          respondent_explanation: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string | null
        }
        Insert: {
          abs_change?: number | null
          benchmarking_id: string
          committee_notes?: string | null
          committee_status?: string | null
          created_at?: string | null
          current_value?: number | null
          field_name: string
          id?: string
          pct_change?: number | null
          previous_value?: number | null
          respondent_action?: string | null
          respondent_explanation?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
        }
        Update: {
          abs_change?: number | null
          benchmarking_id?: string
          committee_notes?: string | null
          committee_status?: string | null
          created_at?: string | null
          current_value?: number | null
          field_name?: string
          id?: string
          pct_change?: number | null
          previous_value?: number | null
          respondent_action?: string | null
          respondent_explanation?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delta_flags_benchmarking_id_fkey"
            columns: ["benchmarking_id"]
            isOneToOne: false
            referencedRelation: "benchmarking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delta_flags_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_scan_events: {
        Row: {
          device: string
          id: string
          occurred_at: string
          organization_id: string
          public_code: string
          source: string
        }
        Insert: {
          device?: string
          id?: string
          occurred_at?: string
          organization_id: string
          public_code: string
          source?: string
        }
        Update: {
          device?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          public_code?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_scan_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_scan_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_ballot_selections: {
        Row: {
          ballot_id: string
          id: string
          nomination_id: string
        }
        Insert: {
          ballot_id: string
          id?: string
          nomination_id: string
        }
        Update: {
          ballot_id?: string
          id?: string
          nomination_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_ballot_selections_ballot_id_fkey"
            columns: ["ballot_id"]
            isOneToOne: false
            referencedRelation: "election_ballots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_ballot_selections_nomination_id_fkey"
            columns: ["nomination_id"]
            isOneToOne: false
            referencedRelation: "nominations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_ballots: {
        Row: {
          abstain: boolean
          edit_count: number
          election_id: string
          first_cast_at: string
          id: string
          last_edited_at: string
          last_edited_by_profile_id: string | null
          organization_id: string
          sealed_at: string | null
        }
        Insert: {
          abstain?: boolean
          edit_count?: number
          election_id: string
          first_cast_at?: string
          id?: string
          last_edited_at?: string
          last_edited_by_profile_id?: string | null
          organization_id: string
          sealed_at?: string | null
        }
        Update: {
          abstain?: boolean
          edit_count?: number
          election_id?: string
          first_cast_at?: string
          id?: string
          last_edited_at?: string
          last_edited_by_profile_id?: string | null
          organization_id?: string
          sealed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "election_ballots_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_ballots_last_edited_by_profile_id_fkey"
            columns: ["last_edited_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_ballots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_ballots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_ballots_sealed: {
        Row: {
          abstain: boolean
          election_id: string
          id: string
          seal_order: number
          selections: string[]
        }
        Insert: {
          abstain?: boolean
          election_id: string
          id?: string
          seal_order: number
          selections?: string[]
        }
        Update: {
          abstain?: boolean
          election_id?: string
          id?: string
          seal_order?: number
          selections?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "election_ballots_sealed_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      election_certifications: {
        Row: {
          appointed_by_profile_id: string | null
          ballots_returned: number
          ballots_sealed: number
          certified_at: string | null
          certified_by_profile_id: string | null
          created_at: string
          election_id: string
          id: string
          reconciled: boolean
          scrutineer_contact_id: string | null
          tie_at_cutoff: boolean
          tie_candidates: string[]
          tie_resolution_method: string | null
          tie_resolution_note: string | null
          tie_resolved_at: string | null
          tie_resolved_by_profile_id: string | null
        }
        Insert: {
          appointed_by_profile_id?: string | null
          ballots_returned: number
          ballots_sealed: number
          certified_at?: string | null
          certified_by_profile_id?: string | null
          created_at?: string
          election_id: string
          id?: string
          reconciled: boolean
          scrutineer_contact_id?: string | null
          tie_at_cutoff?: boolean
          tie_candidates?: string[]
          tie_resolution_method?: string | null
          tie_resolution_note?: string | null
          tie_resolved_at?: string | null
          tie_resolved_by_profile_id?: string | null
        }
        Update: {
          appointed_by_profile_id?: string | null
          ballots_returned?: number
          ballots_sealed?: number
          certified_at?: string | null
          certified_by_profile_id?: string | null
          created_at?: string
          election_id?: string
          id?: string
          reconciled?: boolean
          scrutineer_contact_id?: string | null
          tie_at_cutoff?: boolean
          tie_candidates?: string[]
          tie_resolution_method?: string | null
          tie_resolution_note?: string | null
          tie_resolved_at?: string | null
          tie_resolved_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "election_certifications_appointed_by_profile_id_fkey"
            columns: ["appointed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_certified_by_profile_id_fkey"
            columns: ["certified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: true
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_scrutineer_contact_id_fkey"
            columns: ["scrutineer_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_scrutineer_contact_id_fkey"
            columns: ["scrutineer_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_scrutineer_contact_id_fkey"
            columns: ["scrutineer_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_scrutineer_contact_id_fkey"
            columns: ["scrutineer_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_certifications_tie_resolved_by_profile_id_fkey"
            columns: ["tie_resolved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      election_eligibility: {
        Row: {
          election_id: string
          evaluated_at: string
          facts: Json | null
          id: string
          is_eligible: boolean
          organization_id: string
          reason: string
          reason_code: string
          rule_key: string
        }
        Insert: {
          election_id: string
          evaluated_at?: string
          facts?: Json | null
          id?: string
          is_eligible: boolean
          organization_id: string
          reason: string
          reason_code: string
          rule_key: string
        }
        Update: {
          election_id?: string
          evaluated_at?: string
          facts?: Json | null
          id?: string
          is_eligible?: boolean
          organization_id?: string
          reason?: string
          reason_code?: string
          rule_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_eligibility_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_eligibility_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_eligibility_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_participation: {
        Row: {
          abstained: boolean
          cast_by_profile_ids: string[]
          edit_count: number
          election_id: string
          first_cast_at: string
          id: string
          last_edited_at: string
          organization_id: string
        }
        Insert: {
          abstained?: boolean
          cast_by_profile_ids?: string[]
          edit_count?: number
          election_id: string
          first_cast_at: string
          id?: string
          last_edited_at: string
          organization_id: string
        }
        Update: {
          abstained?: boolean
          cast_by_profile_ids?: string[]
          edit_count?: number
          election_id?: string
          first_cast_at?: string
          id?: string
          last_edited_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_participation_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_participation_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_participation_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_results: {
        Row: {
          elected: boolean
          election_id: string
          id: string
          nomination_id: string
          rank: number
          votes: number
        }
        Insert: {
          elected?: boolean
          election_id: string
          id?: string
          nomination_id: string
          rank: number
          votes: number
        }
        Update: {
          elected?: boolean
          election_id?: string
          id?: string
          nomination_id?: string
          rank?: number
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "election_results_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_results_nomination_id_fkey"
            columns: ["nomination_id"]
            isOneToOne: false
            referencedRelation: "nominations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_seats: {
        Row: {
          election_id: string
          id: string
          incumbent_contact_id: string | null
          incumbent_organization_id: string | null
          incumbent_profile_id: string | null
          seat_key: string
        }
        Insert: {
          election_id: string
          id?: string
          incumbent_contact_id?: string | null
          incumbent_organization_id?: string | null
          incumbent_profile_id?: string | null
          seat_key: string
        }
        Update: {
          election_id?: string
          id?: string
          incumbent_contact_id?: string | null
          incumbent_organization_id?: string | null
          incumbent_profile_id?: string | null
          seat_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_seats_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_contact_id_fkey"
            columns: ["incumbent_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_contact_id_fkey"
            columns: ["incumbent_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_contact_id_fkey"
            columns: ["incumbent_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_contact_id_fkey"
            columns: ["incumbent_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_organization_id_fkey"
            columns: ["incumbent_organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_organization_id_fkey"
            columns: ["incumbent_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_seats_incumbent_profile_id_fkey"
            columns: ["incumbent_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      elections: {
        Row: {
          agm_date: string
          ballots_close_at: string
          ballots_open_at: string
          body_id: string
          config: Json
          created_at: string
          cycle_year: number
          id: string
          nominations_close_at: string
          nominations_open_at: string
          outcome: string | null
          policy_set_id: string | null
          sealed_at: string | null
          seats_available: number
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          agm_date: string
          ballots_close_at: string
          ballots_open_at: string
          body_id: string
          config: Json
          created_at?: string
          cycle_year: number
          id?: string
          nominations_close_at: string
          nominations_open_at: string
          outcome?: string | null
          policy_set_id?: string | null
          sealed_at?: string | null
          seats_available: number
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          agm_date?: string
          ballots_close_at?: string
          ballots_open_at?: string
          body_id?: string
          config?: Json
          created_at?: string
          cycle_year?: number
          id?: string
          nominations_close_at?: string
          nominations_open_at?: string
          outcome?: string | null
          policy_set_id?: string | null
          sealed_at?: string | null
          seats_available?: number
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "elections_body_id_fkey"
            columns: ["body_id"]
            isOneToOne: false
            referencedRelation: "governance_bodies"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_balance_seats: {
        Row: {
          balance_id: string
          conference_id: string
          created_at: string
          entity_id: string
          holder_person_id: string | null
          id: string
          organization_id: string | null
          seat_index: number
        }
        Insert: {
          balance_id: string
          conference_id: string
          created_at?: string
          entity_id: string
          holder_person_id?: string | null
          id?: string
          organization_id?: string | null
          seat_index: number
        }
        Update: {
          balance_id?: string
          conference_id?: string
          created_at?: string
          entity_id?: string
          holder_person_id?: string | null
          id?: string
          organization_id?: string | null
          seat_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "entity_balance_seats_balance_id_fkey"
            columns: ["balance_id"]
            isOneToOne: false
            referencedRelation: "entity_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balance_seats_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balance_seats_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balance_seats_holder_person_id_fkey"
            columns: ["holder_person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balance_seats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balance_seats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_balances: {
        Row: {
          conference_id: string
          created_at: string
          entity_id: string
          id: string
          organization_id: string | null
          purchase_id: string
          quantity: number
        }
        Insert: {
          conference_id: string
          created_at?: string
          entity_id: string
          id?: string
          organization_id?: string | null
          purchase_id: string
          quantity?: number
        }
        Update: {
          conference_id?: string
          created_at?: string
          entity_id?: string
          id?: string
          organization_id?: string | null
          purchase_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "entity_balances_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balances_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_balances_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "entity_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_purchases: {
        Row: {
          buyer: string | null
          buyer_tier: string | null
          conference_id: string
          created_at: string
          id: string
          offer_entity_id: string
          order_item_id: string | null
          price_cents: number | null
          quantity: number
        }
        Insert: {
          buyer?: string | null
          buyer_tier?: string | null
          conference_id: string
          created_at?: string
          id?: string
          offer_entity_id: string
          order_item_id?: string | null
          price_cents?: number | null
          quantity?: number
        }
        Update: {
          buyer?: string | null
          buyer_tier?: string | null
          conference_id?: string
          created_at?: string
          id?: string
          offer_entity_id?: string
          order_item_id?: string | null
          price_cents?: number | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "entity_purchases_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_purchases_offer_entity_id_fkey"
            columns: ["offer_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_purchases_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "conference_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      event_checkins: {
        Row: {
          checked_in_at: string
          checked_in_by: string | null
          event_id: string
          id: string
          registration_id: string
          user_id: string
        }
        Insert: {
          checked_in_at?: string
          checked_in_by?: string | null
          event_id: string
          id?: string
          registration_id: string
          user_id: string
        }
        Update: {
          checked_in_at?: string
          checked_in_by?: string | null
          event_id?: string
          id?: string
          registration_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_checkins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checkins_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          amount_paid_cents: number
          cancelled_at: string | null
          event_id: string
          id: string
          payment_status: string
          registered_at: string
          status: string
          stripe_session_id: string | null
          ticket_type_id: string | null
          user_id: string
        }
        Insert: {
          amount_paid_cents?: number
          cancelled_at?: string | null
          event_id: string
          id?: string
          payment_status?: string
          registered_at?: string
          status?: string
          stripe_session_id?: string | null
          ticket_type_id?: string | null
          user_id: string
        }
        Update: {
          amount_paid_cents?: number
          cancelled_at?: string | null
          event_id?: string
          id?: string
          payment_status?: string
          registered_at?: string
          status?: string
          stripe_session_id?: string | null
          ticket_type_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "event_ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticket_types: {
        Row: {
          audience_filter: Json | null
          available_from: string | null
          available_until: string | null
          capacity: number | null
          created_at: string
          description: string | null
          event_id: string
          id: string
          is_hidden: boolean
          name: string
          price_cents: number
          qbo_item_id: string | null
          sort_order: number
          stripe_price_id: string | null
          updated_at: string
        }
        Insert: {
          audience_filter?: Json | null
          available_from?: string | null
          available_until?: string | null
          capacity?: number | null
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          is_hidden?: boolean
          name: string
          price_cents?: number
          qbo_item_id?: string | null
          sort_order?: number
          stripe_price_id?: string | null
          updated_at?: string
        }
        Update: {
          audience_filter?: Json | null
          available_from?: string | null
          available_until?: string | null
          capacity?: number | null
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          is_hidden?: boolean
          name?: string
          price_cents?: number
          qbo_item_id?: string | null
          sort_order?: number
          stripe_price_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_waitlist: {
        Row: {
          event_id: string
          id: string
          joined_at: string
          position: number
          promoted_at: string | null
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          joined_at?: string
          position: number
          promoted_at?: string | null
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          joined_at?: string
          position?: number
          promoted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          audience_mode: string
          body_html: string | null
          capacity: number | null
          conference_entity_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          google_event_id: string | null
          google_meet_link: string | null
          id: string
          is_virtual: boolean
          location: string | null
          metadata: Json
          refund_policy: Json | null
          slug: string | null
          starts_at: string | null
          status: string
          title: string
          updated_at: string
          virtual_link: string | null
        }
        Insert: {
          audience_mode?: string
          body_html?: string | null
          capacity?: number | null
          conference_entity_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          google_event_id?: string | null
          google_meet_link?: string | null
          id?: string
          is_virtual?: boolean
          location?: string | null
          metadata?: Json
          refund_policy?: Json | null
          slug?: string | null
          starts_at?: string | null
          status?: string
          title: string
          updated_at?: string
          virtual_link?: string | null
        }
        Update: {
          audience_mode?: string
          body_html?: string | null
          capacity?: number | null
          conference_entity_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          google_event_id?: string | null
          google_meet_link?: string | null
          id?: string
          is_virtual?: boolean
          location?: string | null
          metadata?: Json
          refund_policy?: Json | null
          slug?: string | null
          starts_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          virtual_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_conference_entity_id_fkey"
            columns: ["conference_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      explain_requests: {
        Row: {
          created_at: string
          element_selector: string | null
          element_text: string | null
          id: string
          note: string | null
          organization_id: string | null
          page_url: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          element_selector?: string | null
          element_text?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          page_url: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          element_selector?: string | null
          element_text?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          page_url?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explain_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explain_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explain_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flags: {
        Row: {
          created_at: string
          element_content: string | null
          element_selector: string | null
          flagger_email: string
          flagger_id: string
          flagger_name: string | null
          id: string
          note: string | null
          organization_id: string | null
          page_url: string
          priority: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          element_content?: string | null
          element_selector?: string | null
          flagger_email: string
          flagger_id: string
          flagger_name?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          page_url: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          element_content?: string | null
          element_selector?: string | null
          flagger_email?: string
          flagger_id?: string
          flagger_name?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          page_url?: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghost_announcements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_tiptap: Json | null
          circle_post_id: number | null
          circle_post_url: string | null
          circle_space_id: number | null
          created_at: string
          email_campaign_id: string | null
          id: string
          kind: string
          organization_id: string
          published_at: string | null
          skip_reason: string | null
          status: string
          summary_text: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_tiptap?: Json | null
          circle_post_id?: number | null
          circle_post_url?: string | null
          circle_space_id?: number | null
          created_at?: string
          email_campaign_id?: string | null
          id?: string
          kind?: string
          organization_id: string
          published_at?: string | null
          skip_reason?: string | null
          status?: string
          summary_text?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_tiptap?: Json | null
          circle_post_id?: number | null
          circle_post_url?: string | null
          circle_space_id?: number | null
          created_at?: string
          email_campaign_id?: string | null
          id?: string
          kind?: string
          organization_id?: string
          published_at?: string | null
          skip_reason?: string | null
          status?: string
          summary_text?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghost_announcements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghost_announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghost_announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_bodies: {
        Row: {
          created_at: string
          id: string
          key: string
          max_consecutive_terms: number | null
          min_seat_count: number | null
          name: string
          seat_count: number | null
          term_length_years: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          max_consecutive_terms?: number | null
          min_seat_count?: number | null
          name: string
          seat_count?: number | null
          term_length_years?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          max_consecutive_terms?: number | null
          min_seat_count?: number | null
          name?: string
          seat_count?: number | null
          term_length_years?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      governance_role_assignments: {
        Row: {
          appointing_resolution: string | null
          body_id: string
          counts_toward_cap: boolean
          created_at: string
          elected_at_election_id: string | null
          id: string
          notes: string | null
          organization_id: string | null
          person_contact_id: string | null
          person_profile_id: string | null
          role_key: string
          seat_key: string | null
          term_end: string | null
          term_start: string
          updated_at: string
        }
        Insert: {
          appointing_resolution?: string | null
          body_id: string
          counts_toward_cap?: boolean
          created_at?: string
          elected_at_election_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          person_contact_id?: string | null
          person_profile_id?: string | null
          role_key: string
          seat_key?: string | null
          term_end?: string | null
          term_start: string
          updated_at?: string
        }
        Update: {
          appointing_resolution?: string | null
          body_id?: string
          counts_toward_cap?: boolean
          created_at?: string
          elected_at_election_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          person_contact_id?: string | null
          person_profile_id?: string | null
          role_key?: string
          seat_key?: string | null
          term_end?: string | null
          term_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_role_assignments_body_id_fkey"
            columns: ["body_id"]
            isOneToOne: false
            referencedRelation: "governance_bodies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_person_contact_id_fkey"
            columns: ["person_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_person_contact_id_fkey"
            columns: ["person_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_person_contact_id_fkey"
            columns: ["person_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_person_contact_id_fkey"
            columns: ["person_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_role_assignments_person_profile_id_fkey"
            columns: ["person_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_role_capabilities: {
        Row: {
          appointable: boolean
          can_delegate: boolean
          capability: string
          role_key: string
        }
        Insert: {
          appointable?: boolean
          can_delegate?: boolean
          capability: string
          role_key: string
        }
        Update: {
          appointable?: boolean
          can_delegate?: boolean
          capability?: string
          role_key?: string
        }
        Relationships: []
      }
      hero_area_config: {
        Row: {
          cycle_interval_ms: number
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cycle_interval_ms?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cycle_interval_ms?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hero_area_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hero_slide_settings: {
        Row: {
          enabled: boolean
          id: string
          kind: string
          updated_at: string
          updated_by: string | null
          weight: number
        }
        Insert: {
          enabled?: boolean
          id?: string
          kind: string
          updated_at?: string
          updated_by?: string | null
          weight?: number
        }
        Update: {
          enabled?: boolean
          id?: string
          kind?: string
          updated_at?: string
          updated_by?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "hero_slide_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_shares: {
        Row: {
          created_at: string
          created_by: string
          element_end_selector: string | null
          element_selector: string | null
          element_text: string | null
          id: string
          note: string | null
          page_title: string
          page_url: string
          recipient_id: string
          sent_via: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          element_end_selector?: string | null
          element_selector?: string | null
          element_text?: string | null
          id?: string
          note?: string | null
          page_title: string
          page_url: string
          recipient_id: string
          sent_via?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          element_end_selector?: string | null
          element_selector?: string | null
          element_text?: string | null
          id?: string
          note?: string | null
          page_title?: string
          page_url?: string
          recipient_id?: string
          sent_via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_shares_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          billing_period_end: string | null
          billing_period_start: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          due_date: string | null
          external_payment_id: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_pdf_url: string | null
          metadata: Json | null
          organization_id: string
          original_amount_cents: number | null
          paid_at: string | null
          paid_out_of_band_at: string | null
          payment_source: string | null
          proration_discount_pct: number | null
          refund_amount_cents: number | null
          refunded_at: string | null
          reminder_suppressed_at: string | null
          status: string
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          tax_amount_cents: number
          total_cents: number
          type: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          due_date?: string | null
          external_payment_id?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf_url?: string | null
          metadata?: Json | null
          organization_id: string
          original_amount_cents?: number | null
          paid_at?: string | null
          paid_out_of_band_at?: string | null
          payment_source?: string | null
          proration_discount_pct?: number | null
          refund_amount_cents?: number | null
          refunded_at?: string | null
          reminder_suppressed_at?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_amount_cents?: number
          total_cents: number
          type: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          due_date?: string | null
          external_payment_id?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf_url?: string | null
          metadata?: Json | null
          organization_id?: string
          original_amount_cents?: number | null
          paid_at?: string | null
          paid_out_of_band_at?: string | null
          payment_source?: string | null
          proration_discount_pct?: number | null
          refund_amount_cents?: number | null
          refunded_at?: string | null
          reminder_suppressed_at?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_amount_cents?: number
          total_cents?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          id: string
          ip_address: string | null
          legal_version_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          ip_address?: string | null
          legal_version_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          ip_address?: string | null
          legal_version_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_legal_version_id_fkey"
            columns: ["legal_version_id"]
            isOneToOne: false
            referencedRelation: "conference_legal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_nudge_log: {
        Row: {
          id: string
          recipients_count: number
          sent_at: string
          triggered_by_org_id: string | null
          triggered_by_user_id: string | null
        }
        Insert: {
          id?: string
          recipients_count?: number
          sent_at?: string
          triggered_by_org_id?: string | null
          triggered_by_user_id?: string | null
        }
        Update: {
          id?: string
          recipients_count?: number
          sent_at?: string
          triggered_by_org_id?: string | null
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_nudge_log_triggered_by_org_id_fkey"
            columns: ["triggered_by_org_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_nudge_log_triggered_by_org_id_fkey"
            columns: ["triggered_by_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_scores: {
        Row: {
          conference_id: string
          created_at: string
          delegate_registration_id: string
          exhibitor_registration_id: string
          id: string
          is_blackout: boolean
          is_top_5: boolean
          match_reasons: string[]
          scheduler_run_id: string
          score_breakdown: Json
          total_score: number
        }
        Insert: {
          conference_id: string
          created_at?: string
          delegate_registration_id: string
          exhibitor_registration_id: string
          id?: string
          is_blackout?: boolean
          is_top_5?: boolean
          match_reasons?: string[]
          scheduler_run_id: string
          score_breakdown: Json
          total_score: number
        }
        Update: {
          conference_id?: string
          created_at?: string
          delegate_registration_id?: string
          exhibitor_registration_id?: string
          id?: string
          is_blackout?: boolean
          is_top_5?: boolean
          match_reasons?: string[]
          scheduler_run_id?: string
          score_breakdown?: Json
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_scores_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_scores_delegate_registration_id_fkey"
            columns: ["delegate_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_scores_exhibitor_registration_id_fkey"
            columns: ["exhibitor_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_scores_scheduler_run_id_fkey"
            columns: ["scheduler_run_id"]
            isOneToOne: false
            referencedRelation: "scheduler_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_proxies: {
        Row: {
          created_at: string
          created_by: string | null
          document_path: string | null
          form_source: string
          grantor_contact_id: string | null
          grantor_organization_id: string
          id: string
          meeting_id: string
          proxyholder_contact_id: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          signed_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          form_source?: string
          grantor_contact_id?: string | null
          grantor_organization_id: string
          id?: string
          meeting_id: string
          proxyholder_contact_id: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signed_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          form_source?: string
          grantor_contact_id?: string | null
          grantor_organization_id?: string
          id?: string
          meeting_id?: string
          proxyholder_contact_id?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_proxies_grantor_contact_id_fkey"
            columns: ["grantor_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_grantor_contact_id_fkey"
            columns: ["grantor_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_grantor_contact_id_fkey"
            columns: ["grantor_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_grantor_contact_id_fkey"
            columns: ["grantor_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_grantor_organization_id_fkey"
            columns: ["grantor_organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_grantor_organization_id_fkey"
            columns: ["grantor_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "board_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_proxyholder_contact_id_fkey"
            columns: ["proxyholder_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_proxyholder_contact_id_fkey"
            columns: ["proxyholder_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_proxyholder_contact_id_fkey"
            columns: ["proxyholder_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_proxies_proxyholder_contact_id_fkey"
            columns: ["proxyholder_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_slots: {
        Row: {
          conference_id: string
          created_at: string
          day_number: number
          end_time: string
          id: string
          slot_number: number
          start_time: string
          suite_id: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          day_number: number
          end_time: string
          id?: string
          slot_number: number
          start_time: string
          suite_id: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          day_number?: number
          end_time?: string
          id?: string
          slot_number?: number
          start_time?: string
          suite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_slots_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_slots_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "conference_suites"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_assessments: {
        Row: {
          assessment_status: string
          billing_cycle_year: number
          computed_amount_cents: number
          created_at: string
          explanation: string
          fallback_reason_code: string | null
          id: string
          input_snapshot: Json
          is_manual_override: boolean
          metric_key: string
          metric_value: number | null
          organization_id: string
          override_by: string | null
          override_reason: string | null
          policy_set_id: string
          pricing_mode: string
        }
        Insert: {
          assessment_status?: string
          billing_cycle_year: number
          computed_amount_cents: number
          created_at?: string
          explanation: string
          fallback_reason_code?: string | null
          id?: string
          input_snapshot?: Json
          is_manual_override?: boolean
          metric_key: string
          metric_value?: number | null
          organization_id: string
          override_by?: string | null
          override_reason?: string | null
          policy_set_id: string
          pricing_mode: string
        }
        Update: {
          assessment_status?: string
          billing_cycle_year?: number
          computed_amount_cents?: number
          created_at?: string
          explanation?: string
          fallback_reason_code?: string | null
          id?: string
          input_snapshot?: Json
          is_manual_override?: boolean
          metric_key?: string
          metric_value?: number | null
          organization_id?: string
          override_by?: string | null
          override_reason?: string | null
          policy_set_id?: string
          pricing_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_assessments_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_assessments_policy_set_id_fkey"
            columns: ["policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_state_log: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          id: string
          metadata: Json | null
          organization_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["org_membership_status"]
          triggered_by: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          id?: string
          metadata?: Json | null
          organization_id: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["org_membership_status"]
          triggered_by: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["org_membership_status"]
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_state_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_state_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_state_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          canceled_at: string | null
          cancoll_tier: string | null
          created_at: string
          expires_at: string | null
          fte: number | null
          grace_period_started_at: string | null
          id: string
          is_cancoll_member: boolean
          locked_at: string | null
          organization_id: string | null
          person_id: string | null
          program_key: string
          status: Database["public"]["Enums"]["org_membership_status"]
          status_changed_at: string | null
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          cancoll_tier?: string | null
          created_at?: string
          expires_at?: string | null
          fte?: number | null
          grace_period_started_at?: string | null
          id?: string
          is_cancoll_member?: boolean
          locked_at?: string | null
          organization_id?: string | null
          person_id?: string | null
          program_key: string
          status: Database["public"]["Enums"]["org_membership_status"]
          status_changed_at?: string | null
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          cancoll_tier?: string | null
          created_at?: string
          expires_at?: string | null
          fte?: number | null
          grace_period_started_at?: string | null
          id?: string
          is_cancoll_member?: boolean
          locked_at?: string | null
          organization_id?: string | null
          person_id?: string | null
          program_key?: string
          status?: Database["public"]["Enums"]["org_membership_status"]
          status_changed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_automation_runs: {
        Row: {
          campaign_id: string | null
          created_at: string
          error: string | null
          id: string
          processed_at: string | null
          status: Database["public"]["Enums"]["automation_run_status"]
          trigger_event_key: string
          trigger_source: Database["public"]["Enums"]["trigger_source"]
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["automation_run_status"]
          trigger_event_key: string
          trigger_source: Database["public"]["Enums"]["trigger_source"]
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["automation_run_status"]
          trigger_event_key?: string
          trigger_source?: Database["public"]["Enums"]["trigger_source"]
        }
        Relationships: [
          {
            foreignKeyName: "message_automation_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "message_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      message_campaigns: {
        Row: {
          audience_definition: Json
          automation_mode: Database["public"]["Enums"]["automation_mode"] | null
          body_override: string | null
          campaign_id: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          scheduled_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          subject_override: string | null
          template_id: string | null
          trigger_event_key: string | null
          trigger_source: Database["public"]["Enums"]["trigger_source"]
          updated_at: string
          variable_values: Json
        }
        Insert: {
          audience_definition?: Json
          automation_mode?:
            | Database["public"]["Enums"]["automation_mode"]
            | null
          body_override?: string | null
          campaign_id?: string | null
          channel?: Database["public"]["Enums"]["campaign_channel"]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          subject_override?: string | null
          template_id?: string | null
          trigger_event_key?: string | null
          trigger_source?: Database["public"]["Enums"]["trigger_source"]
          updated_at?: string
          variable_values?: Json
        }
        Update: {
          audience_definition?: Json
          automation_mode?:
            | Database["public"]["Enums"]["automation_mode"]
            | null
          body_override?: string | null
          campaign_id?: string | null
          channel?: Database["public"]["Enums"]["campaign_channel"]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          subject_override?: string | null
          template_id?: string | null
          trigger_event_key?: string | null
          trigger_source?: Database["public"]["Enums"]["trigger_source"]
          updated_at?: string
          variable_values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comms_campaign_totals"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "message_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      message_deliveries: {
        Row: {
          bounced_at: string | null
          campaign_id: string
          click_count: number
          complained_at: string | null
          delivered_at: string | null
          error: string | null
          failed_at: string | null
          first_clicked_at: string | null
          id: string
          open_count: number
          opened_at: string | null
          provider_message_id: string | null
          queued_at: string
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
        }
        Insert: {
          bounced_at?: string | null
          campaign_id: string
          click_count?: number
          complained_at?: string | null
          delivered_at?: string | null
          error?: string | null
          failed_at?: string | null
          first_clicked_at?: string | null
          id?: string
          open_count?: number
          opened_at?: string | null
          provider_message_id?: string | null
          queued_at?: string
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
        }
        Update: {
          bounced_at?: string | null
          campaign_id?: string
          click_count?: number
          complained_at?: string | null
          delivered_at?: string | null
          error?: string | null
          failed_at?: string | null
          first_clicked_at?: string | null
          id?: string
          open_count?: number
          opened_at?: string | null
          provider_message_id?: string | null
          queued_at?: string
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
        }
        Relationships: [
          {
            foreignKeyName: "message_deliveries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "message_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "message_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      message_link_clicks: {
        Row: {
          campaign_id: string
          clicked_at: string
          delivery_id: string
          id: string
          url: string
        }
        Insert: {
          campaign_id: string
          clicked_at?: string
          delivery_id: string
          id?: string
          url: string
        }
        Update: {
          campaign_id?: string
          clicked_at?: string
          delivery_id?: string
          id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_link_clicks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "message_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_link_clicks_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "message_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      message_recipients: {
        Row: {
          campaign_id: string
          contact_email: string
          display_name: string | null
          id: string
          resolved_at: string
          user_id: string | null
          variable_overrides: Json
        }
        Insert: {
          campaign_id: string
          contact_email: string
          display_name?: string | null
          id?: string
          resolved_at?: string
          user_id?: string | null
          variable_overrides?: Json
        }
        Update: {
          campaign_id?: string
          contact_email?: string
          display_name?: string | null
          id?: string
          resolved_at?: string
          user_id?: string | null
          variable_overrides?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "message_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body_blocks: Json | null
          body_html: string
          campaign_id: string | null
          category: string
          created_at: string
          description: string | null
          forked_from_template_id: string | null
          id: string
          is_system: boolean
          is_transactional: boolean
          key: string
          name: string
          subject: string
          updated_at: string
          variable_keys: string[]
        }
        Insert: {
          body_blocks?: Json | null
          body_html: string
          campaign_id?: string | null
          category: string
          created_at?: string
          description?: string | null
          forked_from_template_id?: string | null
          id?: string
          is_system?: boolean
          is_transactional?: boolean
          key: string
          name: string
          subject: string
          updated_at?: string
          variable_keys?: string[]
        }
        Update: {
          body_blocks?: Json | null
          body_html?: string
          campaign_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          forked_from_template_id?: string | null
          id?: string
          is_system?: boolean
          is_transactional?: boolean
          key?: string
          name?: string
          subject?: string
          updated_at?: string
          variable_keys?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comms_campaign_totals"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "message_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_forked_from_template_id_fkey"
            columns: ["forked_from_template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      metadata_privacy_rules: {
        Row: {
          appliesTo: string
          created_at: string
          description: string | null
          field_name: string
          id: string
          updated_at: string
          visibility_level: string
        }
        Insert: {
          appliesTo: string
          created_at?: string
          description?: string | null
          field_name: string
          id: string
          updated_at: string
          visibility_level: string
        }
        Update: {
          appliesTo?: string
          created_at?: string
          description?: string | null
          field_name?: string
          id?: string
          updated_at?: string
          visibility_level?: string
        }
        Relationships: []
      }
      nomination_cosignatures: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          nomination_id: string
          organization_id: string
          profile_id: string | null
          revoked_at: string | null
          sign_token: string
          signed_at: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          nomination_id: string
          organization_id: string
          profile_id?: string | null
          revoked_at?: string | null
          sign_token: string
          signed_at?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          nomination_id?: string
          organization_id?: string
          profile_id?: string | null
          revoked_at?: string | null
          sign_token?: string
          signed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nomination_cosignatures_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_nomination_id_fkey"
            columns: ["nomination_id"]
            isOneToOne: false
            referencedRelation: "nominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nomination_cosignatures_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nominations: {
        Row: {
          accept_token: string
          bio: string | null
          candidate_accepted_at: string | null
          candidate_declined_at: string | null
          created_at: string
          election_id: string
          eligibility: Json | null
          id: string
          nominated_by_contact_id: string | null
          nominee_contact_id: string
          nominee_organization_id: string
          nominee_profile_id: string | null
          platform: string | null
          source: string
          status: string
          store_permission_granted_at: string | null
          store_permission_granted_by_contact_id: string | null
          updated_at: string
          withdrawal_requested_at: string | null
          withdrawal_requested_by: string | null
          withdrawn_at: string | null
          withdrawn_reason: string | null
        }
        Insert: {
          accept_token: string
          bio?: string | null
          candidate_accepted_at?: string | null
          candidate_declined_at?: string | null
          created_at?: string
          election_id: string
          eligibility?: Json | null
          id?: string
          nominated_by_contact_id?: string | null
          nominee_contact_id: string
          nominee_organization_id: string
          nominee_profile_id?: string | null
          platform?: string | null
          source: string
          status?: string
          store_permission_granted_at?: string | null
          store_permission_granted_by_contact_id?: string | null
          updated_at?: string
          withdrawal_requested_at?: string | null
          withdrawal_requested_by?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Update: {
          accept_token?: string
          bio?: string | null
          candidate_accepted_at?: string | null
          candidate_declined_at?: string | null
          created_at?: string
          election_id?: string
          eligibility?: Json | null
          id?: string
          nominated_by_contact_id?: string | null
          nominee_contact_id?: string
          nominee_organization_id?: string
          nominee_profile_id?: string | null
          platform?: string | null
          source?: string
          status?: string
          store_permission_granted_at?: string | null
          store_permission_granted_by_contact_id?: string | null
          updated_at?: string
          withdrawal_requested_at?: string | null
          withdrawal_requested_by?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nominations_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominated_by_contact_id_fkey"
            columns: ["nominated_by_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominated_by_contact_id_fkey"
            columns: ["nominated_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominated_by_contact_id_fkey"
            columns: ["nominated_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominated_by_contact_id_fkey"
            columns: ["nominated_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_contact_id_fkey"
            columns: ["nominee_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_contact_id_fkey"
            columns: ["nominee_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_contact_id_fkey"
            columns: ["nominee_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_contact_id_fkey"
            columns: ["nominee_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_organization_id_fkey"
            columns: ["nominee_organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_organization_id_fkey"
            columns: ["nominee_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_nominee_profile_id_fkey"
            columns: ["nominee_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_store_permission_granted_by_contact_id_fkey"
            columns: ["store_permission_granted_by_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_store_permission_granted_by_contact_id_fkey"
            columns: ["store_permission_granted_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_store_permission_granted_by_contact_id_fkey"
            columns: ["store_permission_granted_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_store_permission_granted_by_contact_id_fkey"
            columns: ["store_permission_granted_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nominations_withdrawal_requested_by_fkey"
            columns: ["withdrawal_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notion_schema_cache: {
        Row: {
          appliesTo: string
          database_id: string
          database_name: string
          discovered_at: string
          id: string
          schema_snapshot: Json
        }
        Insert: {
          appliesTo: string
          database_id: string
          database_name: string
          discovered_at?: string
          id: string
          schema_snapshot: Json
        }
        Update: {
          appliesTo?: string
          database_id?: string
          database_name?: string
          discovered_at?: string
          id?: string
          schema_snapshot?: Json
        }
        Relationships: []
      }
      ops_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          details: Json
          due_at: string | null
          id: string
          is_acknowledged: boolean
          message: string
          owner_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          rule_key: string
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          details?: Json
          due_at?: string | null
          id?: string
          is_acknowledged?: boolean
          message: string
          owner_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rule_key: string
          severity: string
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          details?: Json
          due_at?: string | null
          id?: string
          is_acknowledged?: boolean
          message?: string
          owner_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rule_key?: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_alerts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_tags: {
        Row: {
          organization_id: string
          tag_id: string
        }
        Insert: {
          organization_id: string
          tag_id: string
        }
        Update: {
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          action_link_text: string | null
          action_link_url: string | null
          archived_at: string | null
          banner_url: string | null
          canceled_at: string | null
          cancoll_tier: string | null
          catalogue: string | null
          catalogue_url: string | null
          certifications: string[]
          circle_access_group_id: string | null
          circle_id: string | null
          circle_properties: Json | null
          circle_tag_id: string | null
          circle_updated_at: string | null
          city: string | null
          company_description: string | null
          contact_ids: string[] | null
          country: string
          created_at: string
          created_by: string | null
          email: string | null
          email_domain: string | null
          embedding: string | null
          embedding_updated_at: string | null
          files: Json
          fte: number | null
          fte_is_manual_override: boolean
          grace_period_started_at: string | null
          hero_image_url: string | null
          highlight_photo: string | null
          highlight_product_description: string | null
          highlight_product_name: string | null
          highlight_the_deal: string | null
          id: string
          institution_type: string | null
          is_cancoll_member: boolean
          is_test: boolean
          join_date: string | null
          last_edited_time: string | null
          last_synced_circle_at: string | null
          last_synced_notion_at: string | null
          last_synced_qbo_at: string | null
          latitude: number | null
          locked_at: string | null
          logo_horizontal_url: string | null
          logo_url: string | null
          longitude: number | null
          map_profile: string | null
          membership_expires_at: string | null
          membership_started_at: string | null
          membership_status:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          membership_status_changed_at: string | null
          metadata: Json
          nacs_classes: string[] | null
          nacs_department: string | null
          name: string
          notion_id: string | null
          notion_properties: Json | null
          notion_updated_at: string | null
          onboarding_completed_at: string | null
          onboarding_reset_reason: string | null
          onboarding_reset_required: boolean
          onboarding_step: number | null
          organization: string | null
          organization_type: string | null
          partner_links: Json
          payment_status: string | null
          phone: string | null
          postal_code: string | null
          primary_category: string | null
          procurement_info: Json | null
          product_overlay_url: string | null
          profile_visibility: string | null
          province: string | null
          public_code: string | null
          public_contact_confirmed_at: string | null
          purolator_account: string | null
          qbo_invoice_id: string | null
          qbo_updated_at: string | null
          quickbooks_customer_id: string | null
          send_next_email: boolean | null
          show_brand_colors: boolean
          show_contacts: boolean
          show_in_benchmarking: boolean
          show_primary_contact: boolean
          show_store_information: boolean
          slug: string
          source_of_truth: string
          square_footage: number | null
          street_address: string | null
          stripe_customer_id: string | null
          sync_errors: Json | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          tag_ids: string[] | null
          tenant_id: string
          token: string | null
          type: string
          updated_at: string
          website: string | null
          website_scraped_at: string | null
          website_scraped_url: string | null
          website_summary: string | null
        }
        Insert: {
          action_link_text?: string | null
          action_link_url?: string | null
          archived_at?: string | null
          banner_url?: string | null
          canceled_at?: string | null
          cancoll_tier?: string | null
          catalogue?: string | null
          catalogue_url?: string | null
          certifications?: string[]
          circle_access_group_id?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          circle_tag_id?: string | null
          circle_updated_at?: string | null
          city?: string | null
          company_description?: string | null
          contact_ids?: string[] | null
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_domain?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          files?: Json
          fte?: number | null
          fte_is_manual_override?: boolean
          grace_period_started_at?: string | null
          hero_image_url?: string | null
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          highlight_the_deal?: string | null
          id: string
          institution_type?: string | null
          is_cancoll_member?: boolean
          is_test?: boolean
          join_date?: string | null
          last_edited_time?: string | null
          last_synced_circle_at?: string | null
          last_synced_notion_at?: string | null
          last_synced_qbo_at?: string | null
          latitude?: number | null
          locked_at?: string | null
          logo_horizontal_url?: string | null
          logo_url?: string | null
          longitude?: number | null
          map_profile?: string | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_status?:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          membership_status_changed_at?: string | null
          metadata?: Json
          nacs_classes?: string[] | null
          nacs_department?: string | null
          name: string
          notion_id?: string | null
          notion_properties?: Json | null
          notion_updated_at?: string | null
          onboarding_completed_at?: string | null
          onboarding_reset_reason?: string | null
          onboarding_reset_required?: boolean
          onboarding_step?: number | null
          organization?: string | null
          organization_type?: string | null
          partner_links?: Json
          payment_status?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          procurement_info?: Json | null
          product_overlay_url?: string | null
          profile_visibility?: string | null
          province?: string | null
          public_code?: string | null
          public_contact_confirmed_at?: string | null
          purolator_account?: string | null
          qbo_invoice_id?: string | null
          qbo_updated_at?: string | null
          quickbooks_customer_id?: string | null
          send_next_email?: boolean | null
          show_brand_colors?: boolean
          show_contacts?: boolean
          show_in_benchmarking?: boolean
          show_primary_contact?: boolean
          show_store_information?: boolean
          slug: string
          source_of_truth?: string
          square_footage?: number | null
          street_address?: string | null
          stripe_customer_id?: string | null
          sync_errors?: Json | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          tag_ids?: string[] | null
          tenant_id: string
          token?: string | null
          type: string
          updated_at: string
          website?: string | null
          website_scraped_at?: string | null
          website_scraped_url?: string | null
          website_summary?: string | null
        }
        Update: {
          action_link_text?: string | null
          action_link_url?: string | null
          archived_at?: string | null
          banner_url?: string | null
          canceled_at?: string | null
          cancoll_tier?: string | null
          catalogue?: string | null
          catalogue_url?: string | null
          certifications?: string[]
          circle_access_group_id?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          circle_tag_id?: string | null
          circle_updated_at?: string | null
          city?: string | null
          company_description?: string | null
          contact_ids?: string[] | null
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_domain?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          files?: Json
          fte?: number | null
          fte_is_manual_override?: boolean
          grace_period_started_at?: string | null
          hero_image_url?: string | null
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          highlight_the_deal?: string | null
          id?: string
          institution_type?: string | null
          is_cancoll_member?: boolean
          is_test?: boolean
          join_date?: string | null
          last_edited_time?: string | null
          last_synced_circle_at?: string | null
          last_synced_notion_at?: string | null
          last_synced_qbo_at?: string | null
          latitude?: number | null
          locked_at?: string | null
          logo_horizontal_url?: string | null
          logo_url?: string | null
          longitude?: number | null
          map_profile?: string | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_status?:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          membership_status_changed_at?: string | null
          metadata?: Json
          nacs_classes?: string[] | null
          nacs_department?: string | null
          name?: string
          notion_id?: string | null
          notion_properties?: Json | null
          notion_updated_at?: string | null
          onboarding_completed_at?: string | null
          onboarding_reset_reason?: string | null
          onboarding_reset_required?: boolean
          onboarding_step?: number | null
          organization?: string | null
          organization_type?: string | null
          partner_links?: Json
          payment_status?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          procurement_info?: Json | null
          product_overlay_url?: string | null
          profile_visibility?: string | null
          province?: string | null
          public_code?: string | null
          public_contact_confirmed_at?: string | null
          purolator_account?: string | null
          qbo_invoice_id?: string | null
          qbo_updated_at?: string | null
          quickbooks_customer_id?: string | null
          send_next_email?: boolean | null
          show_brand_colors?: boolean
          show_contacts?: boolean
          show_in_benchmarking?: boolean
          show_primary_contact?: boolean
          show_store_information?: boolean
          slug?: string
          source_of_truth?: string
          square_footage?: number | null
          street_address?: string | null
          stripe_customer_id?: string | null
          sync_errors?: Json | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          tag_ids?: string[] | null
          tenant_id?: string
          token?: string | null
          type?: string
          updated_at?: string
          website?: string | null
          website_scraped_at?: string | null
          website_scraped_url?: string | null
          website_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      page_snapshots: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          note: string | null
          page_title: string
          page_url: string
          recipient_email: string | null
          snapshot: Json
          type: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          note?: string | null
          page_title: string
          page_url: string
          recipient_email?: string | null
          snapshot: Json
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          note?: string | null
          page_title?: string
          page_url?: string
          recipient_email?: string | null
          snapshot?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          created_at: string
          id: string
          is_default: boolean
          organization_id: string
          stripe_customer_id: string
          stripe_payment_method_id: string
          updated_at: string
        }
        Insert: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          organization_id: string
          stripe_customer_id: string
          stripe_payment_method_id: string
          updated_at?: string
        }
        Update: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          organization_id?: string
          stripe_customer_id?: string
          stripe_payment_method_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_content_changes: {
        Row: {
          anchor_id: string | null
          batch_id: string | null
          counter_to_id: string | null
          created_at: string
          entity_display_name: string | null
          expires_at: string
          field_display_label: string | null
          id: string
          page_href: string | null
          previous_value: Json | null
          proposed_value: Json
          requested_at: string
          requested_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["pending_change_status"]
          target_column: string
          target_entity_id: string
          target_table: string
          updated_at: string
        }
        Insert: {
          anchor_id?: string | null
          batch_id?: string | null
          counter_to_id?: string | null
          created_at?: string
          entity_display_name?: string | null
          expires_at?: string
          field_display_label?: string | null
          id?: string
          page_href?: string | null
          previous_value?: Json | null
          proposed_value: Json
          requested_at?: string
          requested_by: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["pending_change_status"]
          target_column: string
          target_entity_id: string
          target_table: string
          updated_at?: string
        }
        Update: {
          anchor_id?: string | null
          batch_id?: string | null
          counter_to_id?: string | null
          created_at?: string
          entity_display_name?: string | null
          expires_at?: string
          field_display_label?: string | null
          id?: string
          page_href?: string | null
          previous_value?: Json | null
          proposed_value?: Json
          requested_at?: string
          requested_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["pending_change_status"]
          target_column?: string
          target_entity_id?: string
          target_table?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_content_changes_counter_to_id_fkey"
            columns: ["counter_to_id"]
            isOneToOne: false
            referencedRelation: "pending_content_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_content_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_content_changes_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      people_deprecated: {
        Row: {
          affiliations: Json
          avatar_url: string | null
          bio: string | null
          circle_updated_at: string | null
          circle_user_id: string | null
          communication_preferences: string[] | null
          contact_type: string[] | null
          created_at: string
          created_by: string | null
          dietary_restrictions: string | null
          first_name: string
          id: string
          language_preference: string
          last_contact_date: string | null
          last_login_at: string | null
          last_name: string
          last_synced_circle_at: string | null
          last_synced_notion_at: string | null
          last_synced_qbo_at: string | null
          membership_expires_at: string | null
          membership_started_at: string | null
          membership_status: string | null
          membership_tier: string | null
          metadata: Json
          mobile_phone: string | null
          notes: string | null
          notion_id: string | null
          notion_updated_at: string | null
          organization_id: string | null
          primary_email: string
          qbo_updated_at: string | null
          quickbooks_customer_id: string | null
          role_within_org: string | null
          secondary_emails: string[] | null
          source_of_truth: string
          specialRoles: Json
          staff_department: string | null
          tenant_id: string
          timezone: string
          title: string | null
          updated_at: string
          work_phone: string | null
        }
        Insert: {
          affiliations?: Json
          avatar_url?: string | null
          bio?: string | null
          circle_updated_at?: string | null
          circle_user_id?: string | null
          communication_preferences?: string[] | null
          contact_type?: string[] | null
          created_at?: string
          created_by?: string | null
          dietary_restrictions?: string | null
          first_name: string
          id: string
          language_preference?: string
          last_contact_date?: string | null
          last_login_at?: string | null
          last_name: string
          last_synced_circle_at?: string | null
          last_synced_notion_at?: string | null
          last_synced_qbo_at?: string | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_status?: string | null
          membership_tier?: string | null
          metadata?: Json
          mobile_phone?: string | null
          notes?: string | null
          notion_id?: string | null
          notion_updated_at?: string | null
          organization_id?: string | null
          primary_email: string
          qbo_updated_at?: string | null
          quickbooks_customer_id?: string | null
          role_within_org?: string | null
          secondary_emails?: string[] | null
          source_of_truth?: string
          specialRoles?: Json
          staff_department?: string | null
          tenant_id: string
          timezone?: string
          title?: string | null
          updated_at: string
          work_phone?: string | null
        }
        Update: {
          affiliations?: Json
          avatar_url?: string | null
          bio?: string | null
          circle_updated_at?: string | null
          circle_user_id?: string | null
          communication_preferences?: string[] | null
          contact_type?: string[] | null
          created_at?: string
          created_by?: string | null
          dietary_restrictions?: string | null
          first_name?: string
          id?: string
          language_preference?: string
          last_contact_date?: string | null
          last_login_at?: string | null
          last_name?: string
          last_synced_circle_at?: string | null
          last_synced_notion_at?: string | null
          last_synced_qbo_at?: string | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_status?: string | null
          membership_tier?: string | null
          metadata?: Json
          mobile_phone?: string | null
          notes?: string | null
          notion_id?: string | null
          notion_updated_at?: string | null
          organization_id?: string | null
          primary_email?: string
          qbo_updated_at?: string | null
          quickbooks_customer_id?: string | null
          role_within_org?: string | null
          secondary_emails?: string[] | null
          source_of_truth?: string
          specialRoles?: Json
          staff_department?: string | null
          tenant_id?: string
          timezone?: string
          title?: string | null
          updated_at?: string
          work_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      person_tags: {
        Row: {
          person_id: string
          tag_id: string
        }
        Insert: {
          person_id: string
          tag_id: string
        }
        Update: {
          person_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_config: {
        Row: {
          bootstrapped_at: string | null
          bootstrapped_by: string | null
          client_domain: string
          client_name: string
          client_short_name: string
          created_at: string
          host_org_slug: string | null
          id: string
          logo_url: string | null
          primary_color: string
          support_email: string
          updated_at: string
        }
        Insert: {
          bootstrapped_at?: string | null
          bootstrapped_by?: string | null
          client_domain?: string
          client_name?: string
          client_short_name?: string
          created_at?: string
          host_org_slug?: string | null
          id?: string
          logo_url?: string | null
          primary_color?: string
          support_email?: string
          updated_at?: string
        }
        Update: {
          bootstrapped_at?: string | null
          bootstrapped_by?: string | null
          client_domain?: string
          client_name?: string
          client_short_name?: string
          created_at?: string
          host_org_slug?: string | null
          id?: string
          logo_url?: string | null
          primary_color?: string
          support_email?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_config_bootstrapped_by_fkey"
            columns: ["bootstrapped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_features: {
        Row: {
          always_on: boolean
          config_json: Json
          created_at: string
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          feature_key: string
          id: string
          updated_at: string
        }
        Insert: {
          always_on?: boolean
          config_json?: Json
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature_key: string
          id?: string
          updated_at?: string
        }
        Update: {
          always_on?: boolean
          config_json?: Json
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature_key?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_features_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_change_log: {
        Row: {
          changed_at: string
          changed_by: string
          id: string
          key: string
          new_value_json: Json
          old_value_json: Json | null
          policy_set_id: string
          reason: string | null
        }
        Insert: {
          changed_at?: string
          changed_by: string
          id?: string
          key: string
          new_value_json: Json
          old_value_json?: Json | null
          policy_set_id: string
          reason?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string
          id?: string
          key?: string
          new_value_json?: Json
          old_value_json?: Json | null
          policy_set_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "policy_change_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_change_log_policy_set_id_fkey"
            columns: ["policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_rollbacks: {
        Row: {
          from_policy_set_id: string
          id: string
          reason: string | null
          rolled_back_at: string
          rolled_back_by: string
          to_policy_set_id: string
        }
        Insert: {
          from_policy_set_id: string
          id?: string
          reason?: string | null
          rolled_back_at?: string
          rolled_back_by: string
          to_policy_set_id: string
        }
        Update: {
          from_policy_set_id?: string
          id?: string
          reason?: string | null
          rolled_back_at?: string
          rolled_back_by?: string
          to_policy_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_rollbacks_from_policy_set_id_fkey"
            columns: ["from_policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_rollbacks_rolled_back_by_fkey"
            columns: ["rolled_back_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_rollbacks_to_policy_set_id_fkey"
            columns: ["to_policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_sets: {
        Row: {
          created_at: string
          created_by: string | null
          effective_at: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          published_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          published_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          published_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_sets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_values: {
        Row: {
          category: string
          description: string | null
          display_order: number
          id: string
          is_high_risk: boolean
          key: string
          label: string
          policy_set_id: string
          type: string
          updated_at: string
          validation_schema: Json | null
          value_json: Json
        }
        Insert: {
          category: string
          description?: string | null
          display_order?: number
          id?: string
          is_high_risk?: boolean
          key: string
          label: string
          policy_set_id: string
          type: string
          updated_at?: string
          validation_schema?: Json | null
          value_json: Json
        }
        Update: {
          category?: string
          description?: string | null
          display_order?: number
          id?: string
          is_high_risk?: boolean
          key?: string
          label?: string
          policy_set_id?: string
          type?: string
          updated_at?: string
          validation_schema?: Json | null
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "policy_values_policy_set_id_fkey"
            columns: ["policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          attachments: Json
          author_id: string
          category: string | null
          circle_post_id: string | null
          circle_space_id: string | null
          content: string | null
          created_at: string
          created_by: string | null
          engagement: Json
          excerpt: string | null
          external_url: string | null
          featured_image_url: string | null
          id: string
          published_at: string | null
          slug: string
          source: string
          status: string
          tags: string[] | null
          tenant_id: string
          title: string
          updated_at: string
          visibility: string
          visible_to_roles: string[] | null
        }
        Insert: {
          attachments?: Json
          author_id: string
          category?: string | null
          circle_post_id?: string | null
          circle_space_id?: string | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          engagement?: Json
          excerpt?: string | null
          external_url?: string | null
          featured_image_url?: string | null
          id: string
          published_at?: string | null
          slug: string
          source?: string
          status?: string
          tags?: string[] | null
          tenant_id: string
          title: string
          updated_at: string
          visibility?: string
          visible_to_roles?: string[] | null
        }
        Update: {
          attachments?: Json
          author_id?: string
          category?: string | null
          circle_post_id?: string | null
          circle_space_id?: string | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          engagement?: Json
          excerpt?: string | null
          external_url?: string | null
          featured_image_url?: string | null
          id?: string
          published_at?: string | null
          slug?: string
          source?: string
          status?: string
          tags?: string[] | null
          tenant_id?: string
          title?: string
          updated_at?: string
          visibility?: string
          visible_to_roles?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          global_role: string
          id: string
          preferences: Json
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          global_role?: string
          id: string
          preferences?: Json
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          global_role?: string
          id?: string
          preferences?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      prospective_booth_payments: {
        Row: {
          amount_cents: number
          booth_amount_cents: number
          booth_entity_id: string
          company_name: string
          conference_id: string
          created_at: string
          email: string
          id: string
          linked_application_id: string | null
          membership_amount_cents: number
          paid_at: string | null
          province: string | null
          status: string
          stripe_checkout_session_id: string
        }
        Insert: {
          amount_cents: number
          booth_amount_cents: number
          booth_entity_id: string
          company_name: string
          conference_id: string
          created_at?: string
          email: string
          id?: string
          linked_application_id?: string | null
          membership_amount_cents: number
          paid_at?: string | null
          province?: string | null
          status?: string
          stripe_checkout_session_id: string
        }
        Update: {
          amount_cents?: number
          booth_amount_cents?: number
          booth_entity_id?: string
          company_name?: string
          conference_id?: string
          created_at?: string
          email?: string
          id?: string
          linked_application_id?: string | null
          membership_amount_cents?: number
          paid_at?: string | null
          province?: string | null
          status?: string
          stripe_checkout_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospective_booth_payments_booth_entity_id_fkey"
            columns: ["booth_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospective_booth_payments_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospective_booth_payments_linked_application_id_fkey"
            columns: ["linked_application_id"]
            isOneToOne: false
            referencedRelation: "signup_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      prospective_registration_payments: {
        Row: {
          accepted_document_types: string[]
          amount_cents: number
          conference_id: string
          conference_person_id: string | null
          created_at: string
          dietary_restrictions: string | null
          email: string
          first_name: string
          id: string
          job_title: string | null
          last_name: string
          minted_at: string | null
          offer_entity_id: string
          organization_id: string | null
          organization_name: string
          paid_at: string | null
          phone: string | null
          status: string
          stripe_checkout_session_id: string
        }
        Insert: {
          accepted_document_types?: string[]
          amount_cents: number
          conference_id: string
          conference_person_id?: string | null
          created_at?: string
          dietary_restrictions?: string | null
          email: string
          first_name: string
          id?: string
          job_title?: string | null
          last_name: string
          minted_at?: string | null
          offer_entity_id: string
          organization_id?: string | null
          organization_name: string
          paid_at?: string | null
          phone?: string | null
          status?: string
          stripe_checkout_session_id: string
        }
        Update: {
          accepted_document_types?: string[]
          amount_cents?: number
          conference_id?: string
          conference_person_id?: string | null
          created_at?: string
          dietary_restrictions?: string | null
          email?: string
          first_name?: string
          id?: string
          job_title?: string | null
          last_name?: string
          minted_at?: string | null
          offer_entity_id?: string
          organization_id?: string | null
          organization_name?: string
          paid_at?: string | null
          phone?: string | null
          status?: string
          stripe_checkout_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospective_registration_payments_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospective_registration_payments_conference_person_id_fkey"
            columns: ["conference_person_id"]
            isOneToOne: false
            referencedRelation: "conference_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospective_registration_payments_offer_entity_id_fkey"
            columns: ["offer_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospective_registration_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospective_registration_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      publications: {
        Row: {
          created_at: string
          id: string
          last_printed_at: string | null
          name: string
          sections: Json
          selection: Json
          source: Json
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_printed_at?: string | null
          name: string
          sections?: Json
          selection?: Json
          source: Json
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_printed_at?: string | null
          name?: string
          sections?: Json
          selection?: Json
          source?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_conference_receipt_queue: {
        Row: {
          conference_order_id: string
          created_at: string
          error_message: string | null
          id: string
          lease_expires_at: string | null
          max_retries: number
          next_retry_at: string | null
          processed_at: string | null
          qbo_sales_receipt_id: string | null
          retry_count: number
          status: string
        }
        Insert: {
          conference_order_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_sales_receipt_id?: string | null
          retry_count?: number
          status?: string
        }
        Update: {
          conference_order_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_sales_receipt_id?: string | null
          retry_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_conference_receipt_queue_conference_order_id_fkey"
            columns: ["conference_order_id"]
            isOneToOne: true
            referencedRelation: "conference_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_conference_refund_queue: {
        Row: {
          conference_order_id: string
          created_at: string
          error_message: string | null
          id: string
          lease_expires_at: string | null
          max_retries: number
          next_retry_at: string | null
          processed_at: string | null
          qbo_refund_receipt_id: string | null
          refund_amount_cents: number
          retry_count: number
          status: string
          stripe_refund_id: string
        }
        Insert: {
          conference_order_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_refund_receipt_id?: string | null
          refund_amount_cents: number
          retry_count?: number
          status?: string
          stripe_refund_id: string
        }
        Update: {
          conference_order_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_refund_receipt_id?: string | null
          refund_amount_cents?: number
          retry_count?: number
          status?: string
          stripe_refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_conference_refund_queue_conference_order_id_fkey"
            columns: ["conference_order_id"]
            isOneToOne: false
            referencedRelation: "conference_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_export_queue: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          invoice_id: string
          lease_expires_at: string | null
          max_retries: number
          next_retry_at: string | null
          processed_at: string | null
          qbo_invoice_id: string | null
          qbo_payment_id: string | null
          retry_count: number
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_invoice_id?: string | null
          qbo_payment_id?: string | null
          retry_count?: number
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_invoice_id?: string | null
          qbo_payment_id?: string | null
          retry_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_export_queue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_membership_refund_queue: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          invoice_id: string
          lease_expires_at: string | null
          max_retries: number
          next_retry_at: string | null
          processed_at: string | null
          qbo_refund_receipt_id: string | null
          refund_amount_cents: number
          retry_count: number
          status: string
          stripe_refund_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_refund_receipt_id?: string | null
          refund_amount_cents: number
          retry_count?: number
          status?: string
          stripe_refund_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          processed_at?: string | null
          qbo_refund_receipt_id?: string | null
          refund_amount_cents?: number
          retry_count?: number
          status?: string
          stripe_refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_membership_refund_queue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_misc_receipt_queue: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          lease_expires_at: string | null
          max_retries: number
          next_retry_at: string | null
          payment_id: string
          payment_kind: string
          processed_at: string | null
          qbo_sales_receipt_id: string | null
          retry_count: number
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          payment_id: string
          payment_kind: string
          processed_at?: string | null
          qbo_sales_receipt_id?: string | null
          retry_count?: number
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          max_retries?: number
          next_retry_at?: string | null
          payment_id?: string
          payment_kind?: string
          processed_at?: string | null
          qbo_sales_receipt_id?: string | null
          retry_count?: number
          status?: string
        }
        Relationships: []
      }
      qbo_reconciliation_queue: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          match_strategy: string | null
          matched_invoice_id: string | null
          notes: string | null
          paid_at: string | null
          qbo_customer_id: string | null
          qbo_doc_number: string | null
          qbo_payment_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          match_strategy?: string | null
          matched_invoice_id?: string | null
          notes?: string | null
          paid_at?: string | null
          qbo_customer_id?: string | null
          qbo_doc_number?: string | null
          qbo_payment_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          match_strategy?: string | null
          matched_invoice_id?: string | null
          notes?: string | null
          paid_at?: string | null
          qbo_customer_id?: string | null
          qbo_doc_number?: string | null
          qbo_payment_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_reconciliation_queue_matched_invoice_id_fkey"
            columns: ["matched_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          invoice_id: string | null
          metadata: Json | null
          organization_id: string
          renewal_year: number
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          organization_id: string
          renewal_year: number
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          organization_id?: string
          renewal_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "renewal_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_job_runs: {
        Row: {
          completed_at: string | null
          error_details: Json | null
          id: string
          job_type: string
          metadata: Json | null
          orgs_failed: number | null
          orgs_processed: number | null
          orgs_succeeded: number | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          error_details?: Json | null
          id?: string
          job_type: string
          metadata?: Json | null
          orgs_failed?: number | null
          orgs_processed?: number | null
          orgs_succeeded?: number | null
          started_at?: string
          status: string
        }
        Update: {
          completed_at?: string | null
          error_details?: Json | null
          id?: string
          job_type?: string
          metadata?: Json | null
          orgs_failed?: number | null
          orgs_processed?: number | null
          orgs_succeeded?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      retention_jobs: {
        Row: {
          conference_id: string
          cutoff_at: string
          error_details: string | null
          executed_at: string
          fields_purged: string[]
          id: string
          job_type: string
          policy_set_id: string | null
          records_purged: number
          status: string
        }
        Insert: {
          conference_id: string
          cutoff_at: string
          error_details?: string | null
          executed_at?: string
          fields_purged?: string[]
          id?: string
          job_type?: string
          policy_set_id?: string | null
          records_purged?: number
          status: string
        }
        Update: {
          conference_id?: string
          cutoff_at?: string
          error_details?: string | null
          executed_at?: string
          fields_purged?: string[]
          id?: string
          job_type?: string
          policy_set_id?: string | null
          records_purged?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_jobs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_jobs_policy_set_id_fkey"
            columns: ["policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      rfps: {
        Row: {
          category: string
          closes_at: string
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          document_storage_path: string | null
          id: string
          notifications_sent_at: string | null
          opens_at: string
          organization_id: string
          status: string
          subcategories: string[] | null
          title: string
          updated_at: string | null
          visibility: string
        }
        Insert: {
          category: string
          closes_at: string
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          document_storage_path?: string | null
          id?: string
          notifications_sent_at?: string | null
          opens_at?: string
          organization_id: string
          status?: string
          subcategories?: string[] | null
          title: string
          updated_at?: string | null
          visibility?: string
        }
        Update: {
          category?: string
          closes_at?: string
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          document_storage_path?: string | null
          id?: string
          notifications_sent_at?: string | null
          opens_at?: string
          organization_id?: string
          status?: string
          subcategories?: string[] | null
          title?: string
          updated_at?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_runs: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          completed_at: string | null
          conference_id: string
          constraint_violations: Json | null
          id: string
          metadata: Json | null
          policy_set_id: string
          run_by: string | null
          run_mode: string
          run_seed: number
          started_at: string
          status: string
          total_delegates: number | null
          total_exhibitors: number | null
          total_meetings_created: number | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          completed_at?: string | null
          conference_id: string
          constraint_violations?: Json | null
          id?: string
          metadata?: Json | null
          policy_set_id: string
          run_by?: string | null
          run_mode?: string
          run_seed: number
          started_at?: string
          status?: string
          total_delegates?: number | null
          total_exhibitors?: number | null
          total_meetings_created?: number | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          completed_at?: string | null
          conference_id?: string
          constraint_violations?: Json | null
          id?: string
          metadata?: Json | null
          policy_set_id?: string
          run_by?: string | null
          run_mode?: string
          run_seed?: number
          started_at?: string
          status?: string
          total_delegates?: number | null
          total_exhibitors?: number | null
          total_meetings_created?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_runs_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_runs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_runs_policy_set_id_fkey"
            columns: ["policy_set_id"]
            isOneToOne: false
            referencedRelation: "policy_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_runs_run_by_fkey"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          conference_id: string
          created_at: string
          delegate_registration_ids: string[]
          exhibitor_registration_id: string
          id: string
          is_manual: boolean
          match_score_ids: string[] | null
          meeting_slot_id: string
          scheduler_run_id: string
          status: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          delegate_registration_ids: string[]
          exhibitor_registration_id: string
          id?: string
          is_manual?: boolean
          match_score_ids?: string[] | null
          meeting_slot_id: string
          scheduler_run_id: string
          status?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          delegate_registration_ids?: string[]
          exhibitor_registration_id?: string
          id?: string
          is_manual?: boolean
          match_score_ids?: string[] | null
          meeting_slot_id?: string
          scheduler_run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_exhibitor_registration_id_fkey"
            columns: ["exhibitor_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_meeting_slot_id_fkey"
            columns: ["meeting_slot_id"]
            isOneToOne: false
            referencedRelation: "meeting_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_scheduler_run_id_fkey"
            columns: ["scheduler_run_id"]
            isOneToOne: false
            referencedRelation: "scheduler_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          note: string | null
          page_title: string
          page_url: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          max_uses?: number
          note?: string | null
          page_title: string
          page_url: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          max_uses?: number
          note?: string | null
          page_title?: string
          page_url?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "share_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          billing_account: string
          billing_type: string
          box_height: number
          box_length: number
          box_type: string
          box_width: number
          contact_email: string
          contact_id: string | null
          contact_name: string
          created_at: string | null
          created_by: string | null
          destination_city: string
          destination_country: string | null
          destination_postal_code: string
          destination_province: string
          destination_street: string
          estimated_cost: number | null
          id: string
          notes: string | null
          organization_id: string | null
          organization_name: string
          paid_at: string | null
          payment_status: string | null
          purolator_label_url: string | null
          purolator_response: Json | null
          status: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_invoice_url: string | null
          stripe_payment_id: string | null
          stripe_session_id: string | null
          tracking_number: string | null
          weight: number
        }
        Insert: {
          billing_account: string
          billing_type: string
          box_height: number
          box_length: number
          box_type: string
          box_width: number
          contact_email: string
          contact_id?: string | null
          contact_name: string
          created_at?: string | null
          created_by?: string | null
          destination_city: string
          destination_country?: string | null
          destination_postal_code: string
          destination_province: string
          destination_street: string
          estimated_cost?: number | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          organization_name: string
          paid_at?: string | null
          payment_status?: string | null
          purolator_label_url?: string | null
          purolator_response?: Json | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_id?: string | null
          stripe_session_id?: string | null
          tracking_number?: string | null
          weight: number
        }
        Update: {
          billing_account?: string
          billing_type?: string
          box_height?: number
          box_length?: number
          box_type?: string
          box_width?: number
          contact_email?: string
          contact_id?: string | null
          contact_name?: string
          created_at?: string | null
          created_by?: string | null
          destination_city?: string
          destination_country?: string | null
          destination_postal_code?: string
          destination_province?: string
          destination_street?: string
          estimated_cost?: number | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          organization_name?: string
          paid_at?: string | null
          payment_status?: string | null
          purolator_label_url?: string | null
          purolator_response?: Json | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_id?: string | null
          stripe_session_id?: string | null
          tracking_number?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_applications: {
        Row: {
          applicant_email: string | null
          applicant_name: string | null
          application_data: Json | null
          application_type: string
          created_at: string | null
          duplicate_cleared_at: string | null
          duplicate_cleared_by: string | null
          duplicate_hold_at: string | null
          duplicate_matches: Json | null
          id: string
          organization_id: string | null
          paid_amount_cents: number | null
          paid_at: string | null
          paid_booth_entity_id: string | null
          paid_conference_id: string | null
          paid_for: string | null
          rejection_reason: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          stripe_checkout_session_id: string | null
          updated_at: string | null
          user_id: string | null
          verification_sent_at: string | null
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          applicant_email?: string | null
          applicant_name?: string | null
          application_data?: Json | null
          application_type?: string
          created_at?: string | null
          duplicate_cleared_at?: string | null
          duplicate_cleared_by?: string | null
          duplicate_hold_at?: string | null
          duplicate_matches?: Json | null
          id?: string
          organization_id?: string | null
          paid_amount_cents?: number | null
          paid_at?: string | null
          paid_booth_entity_id?: string | null
          paid_conference_id?: string | null
          paid_for?: string | null
          rejection_reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_sent_at?: string | null
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          applicant_email?: string | null
          applicant_name?: string | null
          application_data?: Json | null
          application_type?: string
          created_at?: string | null
          duplicate_cleared_at?: string | null
          duplicate_cleared_by?: string | null
          duplicate_hold_at?: string | null
          duplicate_matches?: Json | null
          id?: string
          organization_id?: string | null
          paid_amount_cents?: number | null
          paid_at?: string | null
          paid_booth_entity_id?: string | null
          paid_conference_id?: string | null
          paid_for?: string | null
          rejection_reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_sent_at?: string | null
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signup_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signup_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signup_applications_paid_booth_entity_id_fkey"
            columns: ["paid_booth_entity_id"]
            isOneToOne: false
            referencedRelation: "conference_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signup_applications_paid_conference_id_fkey"
            columns: ["paid_conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      site_content: {
        Row: {
          body: string | null
          contact_id: string | null
          content_type: string
          created_at: string
          display_order: number
          id: string
          image_url: string | null
          is_active: boolean
          metadata: Json | null
          section: string
          subtitle: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string | null
          contact_id?: string | null
          content_type?: string
          created_at?: string
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json | null
          section: string
          subtitle?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string | null
          contact_id?: string | null
          content_type?: string
          created_at?: string
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json | null
          section?: string
          subtitle?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_content_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_content_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_content_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_content_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_agreements: {
        Row: {
          created_at: string
          created_by: string | null
          custom_benefits: Json | null
          end_date: string
          id: string
          notes: string | null
          organization_id: string
          signed_at: string | null
          signed_by_contact_id: string | null
          signed_doc_url: string | null
          start_date: string
          status: string
          tier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_benefits?: Json | null
          end_date: string
          id?: string
          notes?: string | null
          organization_id: string
          signed_at?: string | null
          signed_by_contact_id?: string | null
          signed_doc_url?: string | null
          start_date: string
          status?: string
          tier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_benefits?: Json | null
          end_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          signed_at?: string | null
          signed_by_contact_id?: string | null
          signed_doc_url?: string | null
          start_date?: string
          status?: string
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_agreements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_signed_by_contact_id_fkey"
            columns: ["signed_by_contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_signed_by_contact_id_fkey"
            columns: ["signed_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_signed_by_contact_id_fkey"
            columns: ["signed_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_signed_by_contact_id_fkey"
            columns: ["signed_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_agreements_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "sponsor_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_placement_slots: {
        Row: {
          config_schema: Json
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          key: string
          label: string
          location: string
        }
        Insert: {
          config_schema?: Json
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          key: string
          label: string
          location: string
        }
        Update: {
          config_schema?: Json
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          location?: string
        }
        Relationships: []
      }
      sponsor_placements: {
        Row: {
          agreement_id: string
          config_json: Json
          created_at: string
          display_order: number
          end_date: string | null
          id: string
          is_active: boolean
          link_url: string | null
          logo_url: string | null
          slot_id: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          agreement_id: string
          config_json?: Json
          created_at?: string
          display_order?: number
          end_date?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          logo_url?: string | null
          slot_id: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          agreement_id?: string
          config_json?: Json
          created_at?: string
          display_order?: number
          end_date?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          logo_url?: string | null
          slot_id?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_placements_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "sponsor_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_placements_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "sponsor_placement_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_tiers: {
        Row: {
          benefits: Json
          color: string | null
          created_at: string
          description: string | null
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          max_sponsors: number | null
          name: string
          price_cents: number | null
          slug: string
          updated_at: string
        }
        Insert: {
          benefits?: Json
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          max_sponsors?: number | null
          name: string
          price_cents?: number | null
          slug: string
          updated_at?: string
        }
        Update: {
          benefits?: Json
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          max_sponsors?: number | null
          name?: string
          price_cents?: number | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          error_message: string | null
          id: string
          payload: Json | null
          processed_at: string
          result: string
          type: string
        }
        Insert: {
          error_message?: string | null
          id: string
          payload?: Json | null
          processed_at?: string
          result: string
          type: string
        }
        Update: {
          error_message?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string
          result?: string
          type?: string
        }
        Relationships: []
      }
      survey_invitations: {
        Row: {
          contact_id: string | null
          created_at: string | null
          current_page: number | null
          email: string
          expires_at: string
          id: string
          opened_at: string | null
          partial_responses: Json | null
          participant_type: string | null
          responded_at: string | null
          sent_at: string | null
          survey_id: string
          token: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          current_page?: number | null
          email: string
          expires_at: string
          id?: string
          opened_at?: string | null
          partial_responses?: Json | null
          participant_type?: string | null
          responded_at?: string | null
          sent_at?: string | null
          survey_id: string
          token: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          current_page?: number | null
          email?: string
          expires_at?: string
          id?: string
          opened_at?: string | null
          partial_responses?: Json | null
          participant_type?: string | null
          responded_at?: string | null
          sent_at?: string | null
          survey_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          id: string
          participant_type: string | null
          responses: Json
          submitted_from_ip: string | null
          survey_id: string
          updated_at: string | null
          user_agent: string | null
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          participant_type?: string | null
          responses?: Json
          submitted_from_ip?: string | null
          survey_id: string
          updated_at?: string | null
          user_agent?: string | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          participant_type?: string | null
          responses?: Json
          submitted_from_ip?: string | null
          survey_id?: string
          updated_at?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "active_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_circle_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_needing_notion_sync"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          question_config: Json
          slug: string
          status: string
          target_tags: string[] | null
          title: string
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          question_config?: Json
          slug: string
          status?: string
          target_tags?: string[] | null
          title: string
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          question_config?: Json
          slug?: string
          status?: string
          target_tags?: string[] | null
          title?: string
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      swap_cap_increase_requests: {
        Row: {
          admin_note: string | null
          conference_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          delegate_registration_id: string
          id: string
          reason: string | null
          requested_by: string
          requested_extra_swaps: number
          status: string
        }
        Insert: {
          admin_note?: string | null
          conference_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          delegate_registration_id: string
          id?: string
          reason?: string | null
          requested_by: string
          requested_extra_swaps: number
          status?: string
        }
        Update: {
          admin_note?: string | null
          conference_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          delegate_registration_id?: string
          id?: string
          reason?: string | null
          requested_by?: string
          requested_extra_swaps?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_cap_increase_requests_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_cap_increase_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_cap_increase_requests_delegate_registration_id_fkey"
            columns: ["delegate_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_cap_increase_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_requests: {
        Row: {
          admin_override: boolean
          admin_override_by: string | null
          alternatives_generated: Json | null
          conference_id: string
          constraint_check_result: Json | null
          created_at: string
          delegate_registration_id: string
          drop_schedule_id: string
          id: string
          reason: string | null
          replacement_exhibitor_id: string | null
          replacement_schedule_id: string | null
          resolved_at: string | null
          scheduler_run_id: string
          status: string
          swap_number: number
        }
        Insert: {
          admin_override?: boolean
          admin_override_by?: string | null
          alternatives_generated?: Json | null
          conference_id: string
          constraint_check_result?: Json | null
          created_at?: string
          delegate_registration_id: string
          drop_schedule_id: string
          id?: string
          reason?: string | null
          replacement_exhibitor_id?: string | null
          replacement_schedule_id?: string | null
          resolved_at?: string | null
          scheduler_run_id: string
          status?: string
          swap_number: number
        }
        Update: {
          admin_override?: boolean
          admin_override_by?: string | null
          alternatives_generated?: Json | null
          conference_id?: string
          constraint_check_result?: Json | null
          created_at?: string
          delegate_registration_id?: string
          drop_schedule_id?: string
          id?: string
          reason?: string | null
          replacement_exhibitor_id?: string | null
          replacement_schedule_id?: string | null
          resolved_at?: string | null
          scheduler_run_id?: string
          status?: string
          swap_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "swap_requests_admin_override_by_fkey"
            columns: ["admin_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conference_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_delegate_registration_id_fkey"
            columns: ["delegate_registration_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_drop_schedule_id_fkey"
            columns: ["drop_schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_replacement_exhibitor_id_fkey"
            columns: ["replacement_exhibitor_id"]
            isOneToOne: false
            referencedRelation: "conference_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_replacement_schedule_id_fkey"
            columns: ["replacement_schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_scheduler_run_id_fkey"
            columns: ["scheduler_run_id"]
            isOneToOne: false
            referencedRelation: "scheduler_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_log: {
        Row: {
          conflict_data: Json | null
          entity_id: string | null
          entity_type: string
          error_message: string | null
          external_id: string | null
          id: string
          operation: string
          source_system: string
          stack_trace: string | null
          status: string
          synced_at: string
          tenant_id: string
          triggered_by: string | null
          webhook_event_id: string | null
        }
        Insert: {
          conflict_data?: Json | null
          entity_id?: string | null
          entity_type: string
          error_message?: string | null
          external_id?: string | null
          id: string
          operation: string
          source_system: string
          stack_trace?: string | null
          status: string
          synced_at?: string
          tenant_id: string
          triggered_by?: string | null
          webhook_event_id?: string | null
        }
        Update: {
          conflict_data?: Json | null
          entity_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          operation?: string
          source_system?: string
          stack_trace?: string | null
          status?: string
          synced_at?: string
          tenant_id?: string
          triggered_by?: string | null
          webhook_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_operations: {
        Row: {
          completed_at: string | null
          direction: string
          entity_type: string
          error_message: string | null
          id: string
          metadata: Json | null
          records_archived: number | null
          records_created: number | null
          records_processed: number | null
          records_skipped: number | null
          records_updated: number | null
          source: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          direction: string
          entity_type: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          records_archived?: number | null
          records_created?: number | null
          records_processed?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          source: string
          started_at?: string | null
          status: string
        }
        Update: {
          completed_at?: string | null
          direction?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          records_archived?: number | null
          records_created?: number | null
          records_processed?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          source?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          grants_access: boolean
          id: string
          name: string
          notion_id: string | null
          overrides_expiration: boolean
          slug: string
          tenant_id: string
          type: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          grants_access?: boolean
          id: string
          name: string
          notion_id?: string | null
          overrides_expiration?: boolean
          slug: string
          tenant_id: string
          type?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          grants_access?: boolean
          id?: string
          name?: string
          notion_id?: string | null
          overrides_expiration?: boolean
          slug?: string
          tenant_id?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_reconciliation_exceptions: {
        Row: {
          booked_tax_cents: number | null
          charged_tax_cents: number | null
          created_at: string
          created_by: string | null
          expected_tax_cents: number
          id: string
          reason: string
          reference: string
          source: string
        }
        Insert: {
          booked_tax_cents?: number | null
          charged_tax_cents?: number | null
          created_at?: string
          created_by?: string | null
          expected_tax_cents: number
          id?: string
          reason: string
          reference: string
          source: string
        }
        Update: {
          booked_tax_cents?: number | null
          charged_tax_cents?: number | null
          created_at?: string
          created_by?: string | null
          expected_tax_cents?: number
          id?: string
          reason?: string
          reference?: string
          source?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          circle_community_id: string | null
          config: Json
          created_at: string
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          notion_workspace_id: string | null
          primary_color: string | null
          quickbooks_realm_id: string | null
          slug: string
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          circle_community_id?: string | null
          config?: Json
          created_at?: string
          domain?: string | null
          id: string
          logo_url?: string | null
          name: string
          notion_workspace_id?: string | null
          primary_color?: string | null
          quickbooks_realm_id?: string | null
          slug: string
          status?: string
          trial_ends_at?: string | null
          updated_at: string
        }
        Update: {
          circle_community_id?: string | null
          config?: Json
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          notion_workspace_id?: string | null
          primary_color?: string | null
          quickbooks_realm_id?: string | null
          slug?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      update_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          notes: string | null
          organization_id: string
          requester_email: string
          requester_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          notes?: string | null
          organization_id: string
          requester_email: string
          requester_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          notes?: string | null
          organization_id?: string
          requester_email?: string
          requester_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_alert_reads: {
        Row: {
          alert_key: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          alert_key: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          alert_key?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_alert_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bookmarks: {
        Row: {
          created_at: string
          element_end_selector: string | null
          element_selector: string | null
          element_text: string | null
          id: string
          note: string | null
          title: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          element_end_selector?: string | null
          element_selector?: string | null
          element_text?: string | null
          id?: string
          note?: string | null
          title: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          element_end_selector?: string | null
          element_selector?: string | null
          element_text?: string | null
          id?: string
          note?: string | null
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_onboarding_progress: {
        Row: {
          channel: string | null
          completed_at: string | null
          created_at: string
          id: string
          journey_started_at: string
          last_reminder_sent_at: string | null
          persona: string
          reminder_count: number
          sent_at: string | null
          skip_reason: string | null
          skipped_at: string | null
          step_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          journey_started_at?: string
          last_reminder_sent_at?: string | null
          persona: string
          reminder_count?: number
          sent_at?: string | null
          skip_reason?: string | null
          skipped_at?: string | null
          step_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          journey_started_at?: string
          last_reminder_sent_at?: string | null
          persona?: string
          reminder_count?: number
          sent_at?: string | null
          skip_reason?: string | null
          skipped_at?: string | null
          step_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_organizations: {
        Row: {
          created_at: string | null
          hidden: boolean
          id: string
          organization_id: string
          role: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          hidden?: boolean
          id?: string
          organization_id: string
          role?: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          hidden?: boolean
          id?: string
          organization_id?: string
          role?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          computed_permissions: Json
          computed_role: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          last_login_at: string | null
          login_count: number
          onboarding_completed: boolean
          permissions_computed_at: string | null
          person_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          computed_permissions?: Json
          computed_role?: string | null
          created_at?: string
          email: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          login_count?: number
          onboarding_completed?: boolean
          permissions_computed_at?: string | null
          person_id?: string | null
          tenant_id: string
          updated_at: string
        }
        Update: {
          computed_permissions?: Json
          computed_role?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          login_count?: number
          onboarding_completed?: boolean
          permissions_computed_at?: string | null
          person_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_contacts: {
        Row: {
          archived_at: string | null
          circle_id: string | null
          circle_properties: Json | null
          conference_order_id: string | null
          contact_type: string[] | null
          created_at: string | null
          dietary_restrictions: string | null
          email: string | null
          id: string | null
          last_contact_date: string | null
          last_edited_time: string | null
          metadata: Json | null
          name: string | null
          notes: string | null
          notion_id: string | null
          notion_properties: Json | null
          organization_id: string | null
          organization_name: string | null
          organization_slug: string | null
          personal_tag_ids: string[] | null
          phone: string | null
          profile_picture_url: string | null
          role_title: string | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          updated_at: string | null
          vcard: string | null
          vcard_url: string | null
          work_email: string | null
          work_phone_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      active_organizations: {
        Row: {
          action_link_text: string | null
          action_link_url: string | null
          archived_at: string | null
          banner_url: string | null
          catalogue: string | null
          catalogue_url: string | null
          circle_id: string | null
          circle_properties: Json | null
          circle_updated_at: string | null
          city: string | null
          company_description: string | null
          contact_ids: string[] | null
          country: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_domain: string | null
          files: Json | null
          fte: number | null
          hero_image_url: string | null
          highlight_photo: string | null
          highlight_product_description: string | null
          highlight_product_name: string | null
          highlight_the_deal: string | null
          id: string | null
          join_date: string | null
          last_edited_time: string | null
          last_synced_circle_at: string | null
          last_synced_notion_at: string | null
          last_synced_qbo_at: string | null
          latitude: number | null
          logo_horizontal_url: string | null
          logo_url: string | null
          longitude: number | null
          map_profile: string | null
          membership_expires_at: string | null
          membership_started_at: string | null
          membership_status:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          metadata: Json | null
          name: string | null
          notion_id: string | null
          notion_properties: Json | null
          notion_updated_at: string | null
          organization: string | null
          organization_type: string | null
          payment_status: string | null
          phone: string | null
          postal_code: string | null
          primary_category: string | null
          procurement_info: Json | null
          product_overlay_url: string | null
          profile_visibility: string | null
          province: string | null
          purolator_account: string | null
          qbo_invoice_id: string | null
          qbo_updated_at: string | null
          quickbooks_customer_id: string | null
          send_next_email: boolean | null
          slug: string | null
          source_of_truth: string | null
          square_footage: number | null
          street_address: string | null
          sync_errors: Json | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          tag_ids: string[] | null
          tenant_id: string | null
          token: string | null
          type: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          action_link_text?: string | null
          action_link_url?: string | null
          archived_at?: string | null
          banner_url?: string | null
          catalogue?: string | null
          catalogue_url?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          circle_updated_at?: string | null
          city?: string | null
          company_description?: string | null
          contact_ids?: string[] | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_domain?: string | null
          files?: Json | null
          fte?: number | null
          hero_image_url?: string | null
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          highlight_the_deal?: string | null
          id?: string | null
          join_date?: string | null
          last_edited_time?: string | null
          last_synced_circle_at?: string | null
          last_synced_notion_at?: string | null
          last_synced_qbo_at?: string | null
          latitude?: number | null
          logo_horizontal_url?: string | null
          logo_url?: string | null
          longitude?: number | null
          map_profile?: string | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_status?:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          metadata?: Json | null
          name?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          notion_updated_at?: string | null
          organization?: string | null
          organization_type?: string | null
          payment_status?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          procurement_info?: Json | null
          product_overlay_url?: string | null
          profile_visibility?: string | null
          province?: string | null
          purolator_account?: string | null
          qbo_invoice_id?: string | null
          qbo_updated_at?: string | null
          quickbooks_customer_id?: string | null
          send_next_email?: boolean | null
          slug?: string | null
          source_of_truth?: string | null
          square_footage?: number | null
          street_address?: string | null
          sync_errors?: Json | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          tag_ids?: string[] | null
          tenant_id?: string | null
          token?: string | null
          type?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          action_link_text?: string | null
          action_link_url?: string | null
          archived_at?: string | null
          banner_url?: string | null
          catalogue?: string | null
          catalogue_url?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          circle_updated_at?: string | null
          city?: string | null
          company_description?: string | null
          contact_ids?: string[] | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_domain?: string | null
          files?: Json | null
          fte?: number | null
          hero_image_url?: string | null
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          highlight_the_deal?: string | null
          id?: string | null
          join_date?: string | null
          last_edited_time?: string | null
          last_synced_circle_at?: string | null
          last_synced_notion_at?: string | null
          last_synced_qbo_at?: string | null
          latitude?: number | null
          logo_horizontal_url?: string | null
          logo_url?: string | null
          longitude?: number | null
          map_profile?: string | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_status?:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          metadata?: Json | null
          name?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          notion_updated_at?: string | null
          organization?: string | null
          organization_type?: string | null
          payment_status?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          procurement_info?: Json | null
          product_overlay_url?: string | null
          profile_visibility?: string | null
          province?: string | null
          purolator_account?: string | null
          qbo_invoice_id?: string | null
          qbo_updated_at?: string | null
          quickbooks_customer_id?: string | null
          send_next_email?: boolean | null
          slug?: string | null
          source_of_truth?: string | null
          square_footage?: number | null
          street_address?: string | null
          sync_errors?: Json | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          tag_ids?: string[] | null
          tenant_id?: string | null
          token?: string | null
          type?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_contributions: {
        Row: {
          appointable: boolean | null
          assignment_id: string | null
          body_name: string | null
          capability: string | null
          display_name: string | null
          is_active: boolean | null
          reason: string | null
          role_key: string | null
          subject_id: string | null
          term_end: string | null
          term_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_role_assignments_person_profile_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comms_campaign_totals: {
        Row: {
          campaign_id: string | null
          clicked_count: number | null
          complained_count: number | null
          delivered_count: number | null
          failed_count: number | null
          last_sent_at: string | null
          opened_count: number | null
          send_count: number | null
          sent_count: number | null
          total_deliveries: number | null
        }
        Relationships: []
      }
      contacts_needing_circle_sync: {
        Row: {
          archived_at: string | null
          circle_id: string | null
          circle_properties: Json | null
          conference_order_id: string | null
          contact_type: string[] | null
          created_at: string | null
          dietary_restrictions: string | null
          email: string | null
          id: string | null
          last_contact_date: string | null
          last_edited_time: string | null
          metadata: Json | null
          name: string | null
          notes: string | null
          notion_id: string | null
          notion_properties: Json | null
          organization_id: string | null
          personal_tag_ids: string[] | null
          phone: string | null
          profile_picture_url: string | null
          role_title: string | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          updated_at: string | null
          vcard: string | null
          vcard_url: string | null
          work_email: string | null
          work_phone_number: string | null
        }
        Insert: {
          archived_at?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          conference_order_id?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          dietary_restrictions?: string | null
          email?: string | null
          id?: string | null
          last_contact_date?: string | null
          last_edited_time?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          organization_id?: string | null
          personal_tag_ids?: string[] | null
          phone?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          updated_at?: string | null
          vcard?: string | null
          vcard_url?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Update: {
          archived_at?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          conference_order_id?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          dietary_restrictions?: string | null
          email?: string | null
          id?: string | null
          last_contact_date?: string | null
          last_edited_time?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          organization_id?: string | null
          personal_tag_ids?: string[] | null
          phone?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          updated_at?: string | null
          vcard?: string | null
          vcard_url?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts_needing_notion_sync: {
        Row: {
          archived_at: string | null
          circle_id: string | null
          circle_properties: Json | null
          conference_order_id: string | null
          contact_type: string[] | null
          created_at: string | null
          dietary_restrictions: string | null
          email: string | null
          id: string | null
          last_contact_date: string | null
          last_edited_time: string | null
          metadata: Json | null
          name: string | null
          notes: string | null
          notion_id: string | null
          notion_properties: Json | null
          organization_id: string | null
          personal_tag_ids: string[] | null
          phone: string | null
          profile_picture_url: string | null
          role_title: string | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          updated_at: string | null
          vcard: string | null
          vcard_url: string | null
          work_email: string | null
          work_phone_number: string | null
        }
        Insert: {
          archived_at?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          conference_order_id?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          dietary_restrictions?: string | null
          email?: string | null
          id?: string | null
          last_contact_date?: string | null
          last_edited_time?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          organization_id?: string | null
          personal_tag_ids?: string[] | null
          phone?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          updated_at?: string | null
          vcard?: string | null
          vcard_url?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Update: {
          archived_at?: string | null
          circle_id?: string | null
          circle_properties?: Json | null
          conference_order_id?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          dietary_restrictions?: string | null
          email?: string | null
          id?: string | null
          last_contact_date?: string | null
          last_edited_time?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          notion_id?: string | null
          notion_properties?: Json | null
          organization_id?: string | null
          personal_tag_ids?: string[] | null
          phone?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          synced_from_circle_at?: string | null
          synced_from_notion_at?: string | null
          synced_to_circle_at?: string | null
          synced_to_notion_at?: string | null
          updated_at?: string | null
          vcard?: string | null
          vcard_url?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "active_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_campaign_series: {
        Row: {
          campaign_id: string | null
          clicked_count: number | null
          complained_count: number | null
          delivered_count: number | null
          failed_count: number | null
          first_sent_at: string | null
          last_sent_at: string | null
          opened_count: number | null
          send_count: number | null
          sent_count: number | null
          series_key: string | null
          series_label: string | null
          total_deliveries: number | null
        }
        Relationships: []
      }
      user_onboarding_summary: {
        Row: {
          completed_steps: number | null
          journey_started_at: string | null
          last_completed_at: string | null
          pending_steps: number | null
          persona: string | null
          skipped_steps: number | null
          started_at: string | null
          total_steps: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      approve_booth_request: {
        Args: { p_approval_id: string; p_notes?: string }
        Returns: string
      }
      assign_grant_seat: {
        Args: {
          p_actor_id: string
          p_balance_id: string
          p_canonical_person_id?: string
          p_conference_id: string
          p_email?: string
          p_entitlement_type: string
          p_intended_status: string
          p_organization_id: string
          p_person_kind: string
          p_seat_index: number
          p_user_id?: string
        }
        Returns: {
          assignment_status: string
          person_id: string
          previous_status: string
          previous_user_id: string
        }[]
      }
      commit_swap_request: {
        Args: {
          p_actor_id?: string
          p_group_max: number
          p_group_min: number
          p_replacement_schedule_id: string
          p_swap_request_id: string
        }
        Returns: {
          admin_override: boolean
          admin_override_by: string | null
          alternatives_generated: Json | null
          conference_id: string
          constraint_check_result: Json | null
          created_at: string
          delegate_registration_id: string
          drop_schedule_id: string
          id: string
          reason: string | null
          replacement_exhibitor_id: string | null
          replacement_schedule_id: string | null
          resolved_at: string | null
          scheduler_run_id: string
          status: string
          swap_number: number
        }
        SetofOptions: {
          from: "*"
          to: "swap_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_booth_sale: {
        Args: { p_booth_id: string; p_order_id: string; p_org_id: string }
        Returns: string
      }
      create_conference_order_from_cart: {
        Args: {
          p_checkout_idempotency_key: string
          p_conference_id: string
          p_currency?: string
          p_membership_tax_rate_pct?: number
          p_offer_prices?: Json
          p_organization_id: string
          p_price_overrides?: Json
          p_tax_rate_pct?: number
          p_user_id: string
        }
        Returns: {
          checkout_idempotency_key: string | null
          conference_id: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          paid_at: string | null
          refund_amount_cents: number | null
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conference_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      csc_region: { Args: { p_province: string }; Returns: string }
      current_capabilities: { Args: { p_subject: string }; Returns: string[] }
      db_access_drift: { Args: never; Returns: Json }
      ensure_conference_badge_token_for_person: {
        Args: {
          p_actor_id?: string
          p_conference_id: string
          p_person_id: string
        }
        Returns: {
          qr_payload: string
          token_id: string
        }[]
      }
      exec_sql: { Args: { sql: string }; Returns: undefined }
      execute_admin_transfer: {
        Args: { p_completed_by?: string; p_request_id: string }
        Returns: Json
      }
      execute_booth_move: {
        Args: {
          p_actor_id: string
          p_conference_id: string
          p_new_booth_entity_ids: string[]
          p_new_order_subtotal_cents: number
          p_new_order_tax_cents: number
          p_new_order_total_cents: number
          p_new_total_cents: number
          p_old_booth_entity_ids: string[]
          p_old_total_cents: number
          p_organization_id: string
          p_reason: string
          p_refund_ids: string[]
          p_refund_updates: Json
          p_should_mint_immediately: boolean
          p_stripe_checkout_session_id: string
        }
        Returns: Json
      }
      find_organizations_by_email_domain: {
        Args: { p_email: string }
        Returns: {
          action_link_text: string | null
          action_link_url: string | null
          archived_at: string | null
          banner_url: string | null
          canceled_at: string | null
          cancoll_tier: string | null
          catalogue: string | null
          catalogue_url: string | null
          certifications: string[]
          circle_access_group_id: string | null
          circle_id: string | null
          circle_properties: Json | null
          circle_tag_id: string | null
          circle_updated_at: string | null
          city: string | null
          company_description: string | null
          contact_ids: string[] | null
          country: string
          created_at: string
          created_by: string | null
          email: string | null
          email_domain: string | null
          embedding: string | null
          embedding_updated_at: string | null
          files: Json
          fte: number | null
          fte_is_manual_override: boolean
          grace_period_started_at: string | null
          hero_image_url: string | null
          highlight_photo: string | null
          highlight_product_description: string | null
          highlight_product_name: string | null
          highlight_the_deal: string | null
          id: string
          institution_type: string | null
          is_cancoll_member: boolean
          is_test: boolean
          join_date: string | null
          last_edited_time: string | null
          last_synced_circle_at: string | null
          last_synced_notion_at: string | null
          last_synced_qbo_at: string | null
          latitude: number | null
          locked_at: string | null
          logo_horizontal_url: string | null
          logo_url: string | null
          longitude: number | null
          map_profile: string | null
          membership_expires_at: string | null
          membership_started_at: string | null
          membership_status:
            | Database["public"]["Enums"]["org_membership_status"]
            | null
          membership_status_changed_at: string | null
          metadata: Json
          nacs_classes: string[] | null
          nacs_department: string | null
          name: string
          notion_id: string | null
          notion_properties: Json | null
          notion_updated_at: string | null
          onboarding_completed_at: string | null
          onboarding_reset_reason: string | null
          onboarding_reset_required: boolean
          onboarding_step: number | null
          organization: string | null
          organization_type: string | null
          partner_links: Json
          payment_status: string | null
          phone: string | null
          postal_code: string | null
          primary_category: string | null
          procurement_info: Json | null
          product_overlay_url: string | null
          profile_visibility: string | null
          province: string | null
          public_code: string | null
          public_contact_confirmed_at: string | null
          purolator_account: string | null
          qbo_invoice_id: string | null
          qbo_updated_at: string | null
          quickbooks_customer_id: string | null
          send_next_email: boolean | null
          show_brand_colors: boolean
          show_contacts: boolean
          show_in_benchmarking: boolean
          show_primary_contact: boolean
          show_store_information: boolean
          slug: string
          source_of_truth: string
          square_footage: number | null
          street_address: string | null
          stripe_customer_id: string | null
          sync_errors: Json | null
          synced_from_circle_at: string | null
          synced_from_notion_at: string | null
          synced_to_circle_at: string | null
          synced_to_notion_at: string | null
          tag_ids: string[] | null
          tenant_id: string
          token: string | null
          type: string
          updated_at: string
          website: string | null
          website_scraped_at: string | null
          website_scraped_url: string | null
          website_summary: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      find_rfp_notification_recipients: {
        Args: { p_subcategories: string[]; p_visibility: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      get_contact_with_org: {
        Args: { contact_id_param: string }
        Returns: {
          contact: Json
          organization: Json
        }[]
      }
      get_user_permission_state: {
        Args: { p_user_id: string }
        Returns: string
      }
      get_users_by_emails: {
        Args: { p_emails: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      has_capability: {
        Args: { p_capability: string; p_scope_id?: string; p_subject: string }
        Returns: boolean
      }
      increment_share_link_use: {
        Args: { link_id: string }
        Returns: undefined
      }
      lookup_auth_user_emails: {
        Args: { p_user_ids: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      max_delegable_until: {
        Args: { p_child_capability: string; p_subject: string }
        Returns: string
      }
      mint_entity_offer_purchase: {
        Args: {
          p_buyer: string
          p_buyer_tier?: string
          p_conference_id: string
          p_offer_id: string
          p_quantity: number
          p_unit_price?: number
        }
        Returns: string
      }
      mint_prospective_booth_purchase: {
        Args: {
          p_booth_entity_id: string
          p_buyer: string
          p_conference_id: string
          p_organization_id: string
          p_price_cents: number
        }
        Returns: string
      }
      mint_prospective_registration_purchase: {
        Args: {
          p_buyer: string
          p_conference_id: string
          p_organization_id: string
          p_price_cents: number
          p_registration_entity_id: string
        }
        Returns: string
      }
      mint_v3_for_order: { Args: { p_order_id: string }; Returns: number }
      over_exposed_relations: { Args: never; Returns: Json }
      process_conference_order_paid: {
        Args: {
          p_checkout_session_id: string
          p_order_id: string
          p_payment_intent_id?: string
        }
        Returns: {
          checkout_idempotency_key: string | null
          conference_id: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          paid_at: string | null
          refund_amount_cents: number | null
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conference_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      process_conference_order_refund: {
        Args: { p_order_id: string; p_refund_amount_cents: number }
        Returns: {
          checkout_idempotency_key: string | null
          conference_id: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          paid_at: string | null
          refund_amount_cents: number | null
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conference_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      promote_scheduler_run: {
        Args: {
          p_activated_by?: string
          p_conference_id: string
          p_run_id: string
        }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          completed_at: string | null
          conference_id: string
          constraint_violations: Json | null
          id: string
          metadata: Json | null
          policy_set_id: string
          run_by: string | null
          run_mode: string
          run_seed: number
          started_at: string
          status: string
          total_delegates: number | null
          total_exhibitors: number | null
          total_meetings_created: number | null
        }
        SetofOptions: {
          from: "*"
          to: "scheduler_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_policy_draft: {
        Args: {
          p_draft_set_id: string
          p_effective_at?: string
          p_user_id?: string
        }
        Returns: Json
      }
      record_delivery_click: {
        Args: { p_campaign_id: string; p_delivery_id: string; p_url: string }
        Returns: undefined
      }
      record_delivery_open: {
        Args: { p_delivery_id: string }
        Returns: undefined
      }
      reject_booth_request: {
        Args: { p_approval_id: string; p_reason: string }
        Returns: string
      }
      release_expired_booth_holds: { Args: never; Returns: number }
      reserve_booth: {
        Args: { p_booth_id: string; p_org_id: string }
        Returns: string
      }
      reserve_booth_cart_item: {
        Args: {
          p_conference_id: string
          p_expires_at: string
          p_max_booths?: number
          p_offer_entity_id: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: Json
      }
      resolve_person_access: {
        Args: { p_conference_id: string; p_person_id: string }
        Returns: {
          entity_id: string
        }[]
      }
      rollback_policy_to_version: {
        Args: { p_reason?: string; p_target_set_id: string; p_user_id?: string }
        Returns: Json
      }
      run_travel_retention_purge: {
        Args: {
          p_conference_id: string
          p_cutoff_at: string
          p_fields: string[]
          p_policy_set_id: string
        }
        Returns: {
          records_purged: number
          retention_job_id: string
        }[]
      }
      seal_election: {
        Args: { p_election_id: string }
        Returns: {
          participation_count: number
          sealed_count: number
        }[]
      }
      search_partner_embeddings: {
        Args: {
          match_count?: number
          query_embedding: string
          query_text?: string
        }
        Returns: {
          id: string
          score: number
        }[]
      }
      submit_booth_approval_request: {
        Args: {
          p_booth_id: string
          p_conference_id: string
          p_line_items: Json
          p_org_id: string
          p_payment_type: string
          p_po_number?: string
          p_stripe_customer_id?: string
          p_stripe_payment_method_id?: string
          p_stripe_setup_intent_id?: string
          p_subtotal_cents: number
          p_tax_cents: number
          p_total_cents: number
        }
        Returns: string
      }
      transition_membership_state: {
        Args: {
          p_actor_id?: string
          p_metadata?: Json
          p_new_status: Database["public"]["Enums"]["org_membership_status"]
          p_org_id: string
          p_reason?: string
          p_triggered_by: string
        }
        Returns: Json
      }
      unassign_grant_seat: {
        Args: { p_actor_id: string; p_balance_id: string; p_seat_index: number }
        Returns: {
          person_id: string
          previous_status: string
          previous_user_id: string
        }[]
      }
    }
    Enums: {
      automation_mode: "draft_only" | "auto_send"
      automation_run_status: "created_draft" | "sent" | "skipped" | "failed"
      campaign_channel: "email"
      campaign_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "completed"
        | "failed"
        | "canceled"
      comms_initiative_status: "active" | "paused" | "ended"
      delivery_status:
        | "queued"
        | "sent"
        | "delivered"
        | "bounced"
        | "failed"
        | "complained"
      org_membership_status:
        | "applied"
        | "approved"
        | "active"
        | "grace"
        | "locked"
        | "reactivated"
        | "canceled"
      pending_change_status: "pending" | "approved" | "rejected" | "expired"
      trigger_source:
        | "manual"
        | "renewal"
        | "conference"
        | "events"
        | "user_mgmt"
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
      automation_mode: ["draft_only", "auto_send"],
      automation_run_status: ["created_draft", "sent", "skipped", "failed"],
      campaign_channel: ["email"],
      campaign_status: [
        "draft",
        "scheduled",
        "sending",
        "completed",
        "failed",
        "canceled",
      ],
      comms_initiative_status: ["active", "paused", "ended"],
      delivery_status: [
        "queued",
        "sent",
        "delivered",
        "bounced",
        "failed",
        "complained",
      ],
      org_membership_status: [
        "applied",
        "approved",
        "active",
        "grace",
        "locked",
        "reactivated",
        "canceled",
      ],
      pending_change_status: ["pending", "approved", "rejected", "expired"],
      trigger_source: [
        "manual",
        "renewal",
        "conference",
        "events",
        "user_mgmt",
      ],
    },
  },
} as const
