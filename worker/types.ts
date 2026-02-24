export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
}

export interface Variables {
  userId: string;
  userRole: string;
}

export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  role: 'Admin' | 'Staff';
  status: 'Pending' | 'Active' | 'Rejected';
  theme_preference: 'light' | 'dark';
  created_at: string;
  approved_by: number | null;
  approved_at: string | null;
}

export interface Property {
  id: number;
  property_name: string;
  location: string;
  property_owner_name: string;
  phone_01: string;
  phone_02: string | null;
  created_by: number;
  created_at: string;
  updated_by: number | null;
  updated_at: string | null;
}

export interface JwtPayload {
  sub: string;
  role: string;
  iat?: number;
  exp?: number;
}
