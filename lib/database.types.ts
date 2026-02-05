export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          archived_at: string | null
          banner_url: string | null
          catalogue: string | null
          catalogue_url: string | null
          city: string | null
          company_description: string | null
          country: string
          created_at: string
          email: string | null
          fte: number | null
          hero_image_url: string | null
          highlight_photo: string | null
          highlight_product_description: string | null
          highlight_product_name: string | null
          id: string
          join_date: string | null
          latitude: number | null
          longitude: number | null
          logo_url: string | null
          logo_horizontal_url: string | null
          membership_status: string | null
          name: string
          organization_type: string | null
          phone: string | null
          postal_code: string | null
          primary_category: string | null
          product_overlay_url: string | null
          profile_visibility: string | null
          province: string | null
          slug: string
          square_footage: number | null
          street_address: string | null
          tenant_id: string
          type: string
          updated_at: string
          website: string | null
          action_link_url: string | null
          action_link_text: string | null
        }
        Insert: {
          archived_at?: string | null
          banner_url?: string | null
          catalogue?: string | null
          catalogue_url?: string | null
          city?: string | null
          company_description?: string | null
          country?: string
          created_at?: string
          email?: string | null
          fte?: number | null
          hero_image_url?: string | null
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          id: string
          join_date?: string | null
          latitude?: number | null
          longitude?: number | null
          logo_url?: string | null
          logo_horizontal_url?: string | null
          membership_status?: string | null
          name: string
          organization_type?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          product_overlay_url?: string | null
          profile_visibility?: string | null
          province?: string | null
          slug: string
          square_footage?: number | null
          street_address?: string | null
          tenant_id: string
          type: string
          updated_at: string
          website?: string | null
          action_link_url?: string | null
          action_link_text?: string | null
        }
        Update: {
          archived_at?: string | null
          banner_url?: string | null
          catalogue?: string | null
          catalogue_url?: string | null
          city?: string | null
          company_description?: string | null
          country?: string
          created_at?: string
          email?: string | null
          fte?: number | null
          hero_image_url?: string | null
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          id?: string
          join_date?: string | null
          latitude?: number | null
          longitude?: number | null
          logo_url?: string | null
          logo_horizontal_url?: string | null
          membership_status?: string | null
          name?: string
          organization_type?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          product_overlay_url?: string | null
          profile_visibility?: string | null
          province?: string | null
          slug?: string
          square_footage?: number | null
          street_address?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
          website?: string | null
          action_link_url?: string | null
          action_link_text?: string | null
        }
      }
      contacts: {
        Row: {
          archived_at: string | null
          contact_type: string[] | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          organization_id: string | null
          phone: string | null
          profile_picture_url: string | null
          role_title: string | null
          updated_at: string | null
          work_email: string | null
          work_phone_number: string | null
        }
        Insert: {
          archived_at?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          organization_id?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          updated_at?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
        Update: {
          archived_at?: string | null
          contact_type?: string[] | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          role_title?: string | null
          updated_at?: string | null
          work_email?: string | null
          work_phone_number?: string | null
        }
      }
      brand_colors: {
        Row: {
          id: string
          organization_id: string
          name: string | null
          sort_order: number | null
          hex: string | null
          rgb_r: number | null
          rgb_g: number | null
          rgb_b: number | null
          cmyk_c: number | null
          cmyk_m: number | null
          cmyk_y: number | null
          cmyk_k: number | null
          pantone: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          name?: string | null
          sort_order?: number | null
          hex?: string | null
          rgb_r?: number | null
          rgb_g?: number | null
          rgb_b?: number | null
          cmyk_c?: number | null
          cmyk_m?: number | null
          cmyk_y?: number | null
          cmyk_k?: number | null
          pantone?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string | null
          sort_order?: number | null
          hex?: string | null
          rgb_r?: number | null
          rgb_g?: number | null
          rgb_b?: number | null
          cmyk_c?: number | null
          cmyk_m?: number | null
          cmyk_y?: number | null
          cmyk_k?: number | null
          pantone?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      benchmarking: {
        Row: {
          id: string
          organization_id: string
          fiscal_year: number
          institution_type: string | null
          is_semester_based: boolean | null
          enrollment_fte: number | null
          num_store_locations: number | null
          total_square_footage: number | null
          operations_mandate: string | null
          services_offered: string[] | null
          payment_options: string[] | null
          shopping_services: string[] | null
          store_in_stores: string[] | null
          ebook_delivery_system: string | null
          pos_system: string | null
          pos_runs_inventory: boolean | null
          student_info_system: string | null
          lms_system: string | null
          manager_years_current_position: number | null
          manager_years_in_industry: number | null
          fulltime_employees: number | null
          parttime_fte_offpeak: number | null
          student_fte_average: number | null
          total_gross_sales_instore: number | null
          total_online_sales: number | null
          sales_course_materials: number | null
          sales_course_materials_online: number | null
          sales_course_supplies: number | null
          sales_course_supplies_online: number | null
          sales_general_books: number | null
          sales_technology: number | null
          sales_stationary: number | null
          sales_apparel: number | null
          sales_gifts_drinkware: number | null
          sales_custom_merch: number | null
          sales_food_beverage: number | null
          total_cogs: number | null
          expense_hr: number | null
          expense_rent_maintenance: number | null
          net_profit: number | null
          special_charges_notes: string | null
          central_funding: number | null
          contributions_to_campus: string[] | null
          shrink_percentage: number | null
          textbooks_online_only: boolean | null
          custom_imprint_online_only: boolean | null
          computers_online_only: boolean | null
          other_online_only: string | null
          non_textbook_online_percentage: number | null
          marketing_spend: number | null
          social_media_platforms: string[] | null
          social_media_frequency: string | null
          social_media_run_by: string | null
          physical_inventory_schedule: string[] | null
          weekday_hours_open: string | null
          weekday_hours_close: string | null
          saturday_hours_open: string | null
          saturday_hours_close: string | null
          sunday_hours_open: string | null
          sunday_hours_close: string | null
          hours_vary_seasonally: boolean | null
          visibility: string | null
          submitted_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          fiscal_year: number
          institution_type?: string | null
          is_semester_based?: boolean | null
          enrollment_fte?: number | null
          num_store_locations?: number | null
          total_square_footage?: number | null
          operations_mandate?: string | null
          services_offered?: string[] | null
          payment_options?: string[] | null
          shopping_services?: string[] | null
          store_in_stores?: string[] | null
          ebook_delivery_system?: string | null
          pos_system?: string | null
          pos_runs_inventory?: boolean | null
          student_info_system?: string | null
          lms_system?: string | null
          manager_years_current_position?: number | null
          manager_years_in_industry?: number | null
          fulltime_employees?: number | null
          parttime_fte_offpeak?: number | null
          student_fte_average?: number | null
          total_gross_sales_instore?: number | null
          total_online_sales?: number | null
          sales_course_materials?: number | null
          sales_course_materials_online?: number | null
          sales_course_supplies?: number | null
          sales_course_supplies_online?: number | null
          sales_general_books?: number | null
          sales_technology?: number | null
          sales_stationary?: number | null
          sales_apparel?: number | null
          sales_gifts_drinkware?: number | null
          sales_custom_merch?: number | null
          sales_food_beverage?: number | null
          total_cogs?: number | null
          expense_hr?: number | null
          expense_rent_maintenance?: number | null
          net_profit?: number | null
          special_charges_notes?: string | null
          central_funding?: number | null
          contributions_to_campus?: string[] | null
          shrink_percentage?: number | null
          textbooks_online_only?: boolean | null
          custom_imprint_online_only?: boolean | null
          computers_online_only?: boolean | null
          other_online_only?: string | null
          non_textbook_online_percentage?: number | null
          marketing_spend?: number | null
          social_media_platforms?: string[] | null
          social_media_frequency?: string | null
          social_media_run_by?: string | null
          physical_inventory_schedule?: string[] | null
          weekday_hours_open?: string | null
          weekday_hours_close?: string | null
          saturday_hours_open?: string | null
          saturday_hours_close?: string | null
          sunday_hours_open?: string | null
          sunday_hours_close?: string | null
          hours_vary_seasonally?: boolean | null
          visibility?: string | null
          submitted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          fiscal_year?: number
          institution_type?: string | null
          is_semester_based?: boolean | null
          enrollment_fte?: number | null
          num_store_locations?: number | null
          total_square_footage?: number | null
          operations_mandate?: string | null
          services_offered?: string[] | null
          payment_options?: string[] | null
          shopping_services?: string[] | null
          store_in_stores?: string[] | null
          ebook_delivery_system?: string | null
          pos_system?: string | null
          pos_runs_inventory?: boolean | null
          student_info_system?: string | null
          lms_system?: string | null
          manager_years_current_position?: number | null
          manager_years_in_industry?: number | null
          fulltime_employees?: number | null
          parttime_fte_offpeak?: number | null
          student_fte_average?: number | null
          total_gross_sales_instore?: number | null
          total_online_sales?: number | null
          sales_course_materials?: number | null
          sales_course_materials_online?: number | null
          sales_course_supplies?: number | null
          sales_course_supplies_online?: number | null
          sales_general_books?: number | null
          sales_technology?: number | null
          sales_stationary?: number | null
          sales_apparel?: number | null
          sales_gifts_drinkware?: number | null
          sales_custom_merch?: number | null
          sales_food_beverage?: number | null
          total_cogs?: number | null
          expense_hr?: number | null
          expense_rent_maintenance?: number | null
          net_profit?: number | null
          special_charges_notes?: string | null
          central_funding?: number | null
          contributions_to_campus?: string[] | null
          shrink_percentage?: number | null
          textbooks_online_only?: boolean | null
          custom_imprint_online_only?: boolean | null
          computers_online_only?: boolean | null
          other_online_only?: string | null
          non_textbook_online_percentage?: number | null
          marketing_spend?: number | null
          social_media_platforms?: string[] | null
          social_media_frequency?: string | null
          social_media_run_by?: string | null
          physical_inventory_schedule?: string[] | null
          weekday_hours_open?: string | null
          weekday_hours_close?: string | null
          saturday_hours_open?: string | null
          saturday_hours_close?: string | null
          sunday_hours_open?: string | null
          sunday_hours_close?: string | null
          hours_vary_seasonally?: boolean | null
          visibility?: string | null
          submitted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
    }
    Views: {
      active_organizations: {
        Row: {
          archived_at: string | null
          banner_url: string | null
          city: string | null
          company_description: string | null
          fte: number | null
          highlight_photo: string | null
          highlight_product_description: string | null
          highlight_product_name: string | null
          id: string | null
          join_date: string | null
          logo_url: string | null
          membership_status: string | null
          name: string | null
          organization_type: string | null
          phone: string | null
          postal_code: string | null
          primary_category: string | null
          province: string | null
          slug: string | null
          street_address: string | null
          type: string | null
          website: string | null
          catalogue_url: string | null
        }
      }
      active_contacts: {
        Row: {
          archived_at: string | null
          contact_type: string[] | null
          email: string | null
          id: string | null
          name: string | null
          organization_id: string | null
          organization_name: string | null
          organization_slug: string | null
          phone: string | null
          profile_picture_url: string | null
          role_title: string | null
          work_email: string | null
          work_phone_number: string | null
        }
      }
    }
    Functions: {}
    Enums: {}
  }
}

// Helper types
export type Organization = Database['public']['Tables']['organizations']['Row']
export type Contact = Database['public']['Tables']['contacts']['Row']
export type BrandColor = Database['public']['Tables']['brand_colors']['Row']
export type Benchmarking = Database['public']['Tables']['benchmarking']['Row']
export type ActiveOrganization = Database['public']['Views']['active_organizations']['Row']
export type ActiveContact = Database['public']['Views']['active_contacts']['Row']
