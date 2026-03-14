/**
 * Zammad API Types
 *
 * Based on Zammad REST API documentation
 * @see https://docs.zammad.org/en/latest/api/intro.html
 */

export interface ZammadOrganization {
  id: number;
  name: string;
  shared: boolean;
  domain: string;
  domain_assignment: boolean;
  active: boolean;
  note: string | null;
  created_by_id: number;
  updated_by_id: number;
  created_at: string;
  updated_at: string;
  // Custom attribute
  brand?: string;
}

export interface CreateOrganizationInput {
  name: string;
  shared?: boolean;
  domain?: string;
  domain_assignment?: boolean;
  active?: boolean;
  note?: string;
  // Custom brand attribute for platform identification
  brand?: string;
}

export interface ZammadUser {
  id: number;
  organization_id: number | null;
  login: string;
  firstname: string;
  lastname: string;
  email: string;
  image: string | null;
  image_source: string | null;
  web: string;
  phone: string;
  fax: string;
  mobile: string;
  department: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  address: string;
  vip: boolean;
  verified: boolean;
  active: boolean;
  note: string | null;
  last_login: string | null;
  source: string | null;
  login_failed: number;
  out_of_office: boolean;
  out_of_office_start_at: string | null;
  out_of_office_end_at: string | null;
  out_of_office_replacement_id: number | null;
  preferences: Record<string, unknown>;
  updated_by_id: number;
  created_by_id: number;
  created_at: string;
  updated_at: string;
  role_ids: number[];
  organization_ids: number[];
  authorization_ids: number[];
  karma_user_ids: number[];
  group_ids: Record<string, string[]>;
}

export interface CreateUserInput {
  login?: string;
  firstname: string;
  lastname: string;
  email: string;
  organization_id?: number;
  phone?: string;
  active?: boolean;
  note?: string;
  verified?: boolean;
  role_ids?: number[];
}

export interface ZammadGroup {
  id: number;
  signature_id: number | null;
  email_address_id: number | null;
  name: string;
  assignment_timeout: number | null;
  follow_up_possible: string;
  follow_up_assignment: boolean;
  active: boolean;
  note: string;
  updated_by_id: number;
  created_by_id: number;
  created_at: string;
  updated_at: string;
}

export interface ZammadTicket {
  id: number;
  group_id: number;
  priority_id: number;
  state_id: number;
  organization_id: number | null;
  number: string;
  title: string;
  owner_id: number;
  customer_id: number;
  note: string | null;
  first_response_at: string | null;
  first_response_escalation_at: string | null;
  first_response_in_min: number | null;
  first_response_diff_in_min: number | null;
  close_at: string | null;
  close_escalation_at: string | null;
  close_in_min: number | null;
  close_diff_in_min: number | null;
  update_escalation_at: string | null;
  update_in_min: number | null;
  update_diff_in_min: number | null;
  last_contact_at: string | null;
  last_contact_agent_at: string | null;
  last_contact_customer_at: string | null;
  last_owner_update_at: string | null;
  create_article_type_id: number;
  create_article_sender_id: number;
  article_count: number;
  escalation_at: string | null;
  pending_time: string | null;
  type: string | null;
  time_unit: string | null;
  preferences: Record<string, unknown>;
  updated_by_id: number;
  created_by_id: number;
  created_at: string;
  updated_at: string;
  article_ids?: number[];
}

export interface CreateTicketInput {
  title: string;
  group: string; // Zammad group name for ticket routing
  customer_id: number;
  article: {
    subject?: string;
    body: string;
    type: "web" | "email" | "phone" | "note";
    internal?: boolean;
    sender?: "Customer" | "Agent" | "System";
  };
  priority_id?: number;
  state_id?: number;
  note?: string;
}

export interface ZammadArticle {
  id: number;
  ticket_id: number;
  type_id: number;
  sender_id: number;
  from: string;
  to: string;
  cc: string;
  subject: string;
  reply_to: string;
  message_id: string;
  message_id_md5: string;
  in_reply_to: string;
  content_type: string;
  references: string;
  body: string;
  internal: boolean;
  preferences: Record<string, unknown>;
  updated_by_id: number;
  created_by_id: number;
  origin_by_id: number | null;
  created_at: string;
  updated_at: string;
  attachments: ZammadAttachment[];
  type: string;
  sender: string;
}

export interface ZammadAttachment {
  id: number;
  filename: string;
  size: string;
  preferences: {
    "Content-Type": string;
    Mime?: string;
  };
}

export interface CreateArticleInput {
  ticket_id: number;
  body: string;
  type: "web" | "email" | "phone" | "note";
  internal?: boolean;
  sender?: "Customer" | "Agent" | "System";
  subject?: string;
}

export interface ZammadTicketState {
  id: number;
  state_type_id: number;
  name: string;
  next_state_id: number | null;
  ignore_escalation: boolean;
  default_create: boolean;
  default_follow_up: boolean;
  note: string | null;
  active: boolean;
  updated_by_id: number;
  created_by_id: number;
  created_at: string;
  updated_at: string;
}

export interface ZammadPagination<T> {
  data: T[];
  page: number;
  per_page: number;
  total: number;
}

// Common ticket state names in Zammad
export type TicketStateName =
  | "new"
  | "open"
  | "pending reminder"
  | "pending close"
  | "closed"
  | "merged"
  | "removed";
