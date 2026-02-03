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
          highlight_photo: string | null
          highlight_product_description: string | null
          highlight_product_name: string | null
          id: string
          join_date: string | null
          latitude: number | null
          longitude: number | null
          logo_url: string | null
          membership_status: string | null
          name: string
          organization_type: string | null
          phone: string | null
          postal_code: string | null
          primary_category: string | null
          province: string | null
          slug: string
          street_address: string | null
          tenant_id: string
          type: string
          updated_at: string
          website: string | null
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
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          id: string
          join_date?: string | null
          latitude?: number | null
          longitude?: number | null
          logo_url?: string | null
          membership_status?: string | null
          name: string
          organization_type?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          province?: string | null
          slug: string
          street_address?: string | null
          tenant_id: string
          type: string
          updated_at: string
          website?: string | null
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
          highlight_photo?: string | null
          highlight_product_description?: string | null
          highlight_product_name?: string | null
          id?: string
          join_date?: string | null
          latitude?: number | null
          longitude?: number | null
          logo_url?: string | null
          membership_status?: string | null
          name?: string
          organization_type?: string | null
          phone?: string | null
          postal_code?: string | null
          primary_category?: string | null
          province?: string | null
          slug?: string
          street_address?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
          website?: string | null
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
export type ActiveOrganization = Database['public']['Views']['active_organizations']['Row']
export type ActiveContact = Database['public']['Views']['active_contacts']['Row']
