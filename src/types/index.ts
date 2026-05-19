export type UserRole = 'admin' | 'staff' | 'company';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId?: string;
  avatar?: string;
  isActive?: boolean;
}

export interface Company {
  id: string;
  name: string;
  cnpj: string;
  contactName: string;
  email: string;
  phone?: string;
  isActive: boolean;
  publicToken: string;
  createdAt: Date;
}

export type ProjectStatus =
  | 'pending'
  | 'analysis'
  | 'documentation'
  | 'approval'
  | 'approved'
  | 'rejected'
  | 'completed';

export type DocumentType =
  | 'energy_bill_generator'
  | 'energy_bill_beneficiaries'
  | 'holder_document'
  | 'entrance_standard_photo'
  | 'breaker_photo'
  | 'other_photos';

export interface ProjectDocument {
  id: string;
  projectId: string;
  name: string;
  type: DocumentType;
  typeLabel: string;
  fileType: string;
  url: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface Project {
  id: string;
  code: string;
  holderName: string;
  holderCpfCnpj: string;
  holderEmail: string;
  holderPhone: string;
  address: string;
  city: string;
  state: string;
  isRural: boolean;
  coordinates?: string;
  utilityCompany: string;
  consumerUnitNumber: string;
  installedPower: number;
  moduleQuantity: number;
  inverterModel: string;
  status: ProjectStatus;
  companyId: string;
  companyName: string;
  hasBeneficiaries?: boolean;
  circuitBreakerCurrent?: string;
  projectValue?: number;
  paidValue?: number;
  paymentStatus?: 'pending' | 'partial' | 'paid';
  createdAt: Date;
  updatedAt: Date;
}

// Keep backward compatibility
export interface Document {
  id: string;
  projectId: string;
  name: string;
  type: string;
  url: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface Comment {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  content: string;
  createdAt: Date;
}

export interface HistoryEntry {
  id: string;
  projectId: string;
  action: string;
  description: string;
  userId: string;
  userName: string;
  createdAt: Date;
}

export interface KanbanColumn {
  id: ProjectStatus;
  title: string;
  color: string;
}
