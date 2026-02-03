// Organization Types
export interface Organization {
  // Core Identity
  id: string;
  name: string;
  type: "member" | "partner";

  // Location
  location: {
    address: string;
    city: string;
    province: string;
    postalCode: string;
    coordinates: {
      lat: number;
      lng: number;
    };
  };

  // Branding
  branding: {
    logo: string;
    heroImage?: string;
    primaryColor: string;
    secondaryColor?: string;
  };

  // Basic Info
  website?: string;
  description: string;
  memberSince?: number;

  // Member-Specific
  metrics?: {
    fte?: number;
    squareFootage?: number;
    institutionSize?: "small" | "medium" | "large";
  };

  // Partner-Specific
  products?: Product[];
  catalogueUrl?: string;
  activeInstitutions?: number;

  // Contacts
  contacts: Contact[];
}

export interface Contact {
  name: string;
  role: string;
  roleCategory: "decision-maker" | "buyer" | "operations" | "technical" | "financial";
  email: string;
  phone?: string;
  isPrimary: boolean;
}

export interface Product {
  name: string;
  description: string;
  category: string;
  image?: string;
}

// Permission States
export type PermissionState = "public" | "member" | "partner";

// Auth Context Type
export interface AuthContextType {
  permissionState: PermissionState;
  setPermissionState: (state: PermissionState) => void;
}
