export type UserRole = 'ADMIN' | 'STAFF' | 'CUSTOMER';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: AccountStatus;
  customerId?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  userId?: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  gstin?: string;
  billingAddress?: string;
  status: AccountStatus;
  createdAt: string;
}

export interface Staff {
  id: string;
  userId?: string;
  name: string;
  email: string;
  department?: string;
  role: 'ADMIN' | 'STAFF';
  status: AccountStatus;
  createdAt: string;
}

export type ProductType = 'SERVICE' | 'SAAS' | 'ADDON' | 'LICENSE';

export interface Product {
  id: string;
  name: string;
  productType: ProductType;
  salesPricePaise: number;
  costPricePaise: number;
  description?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  attributeName: string;
  attributeValue: string;
  additionalPricePaise: number;
  sku?: string;
  status: AccountStatus;
}

export type BillingFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Plan {
  id: string;
  name: string;
  relatedProductIds?: string[];
  pricePaise: number;
  billingFrequency: BillingFrequency;
  minQuantity: number;
  availableFrom?: string;
  availableUntil?: string;
  autoCloseDays?: number;
  allowEarlyClosure: boolean;
  allowPause: boolean;
  allowRenewal: boolean;
  status: AccountStatus;
  createdAt: string;
}

export interface QuotationTemplate {
  id: string;
  name: string;
  planId: string;
  validityDays: number;
  description?: string;
  defaultProductIds?: string[];
  createdAt: string;
}

export type QuotationStatus = 'DRAFT' | 'QUOTATION' | 'CONFIRMED' | 'ACTIVE' | 'CLOSED';

export interface Quotation {
  id: string;
  quotationNumber: string;
  customerId: string;
  customerName?: string;
  planId: string;
  planName?: string;
  validityDays?: number;
  validUntil?: string;
  taxRuleId?: string;
  discountCode?: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  status: QuotationStatus;
  convertedSubscriptionId?: string;
  createdAt: string;
}

export type SubscriptionStatus = 'DRAFT' | 'QUOTATION' | 'CONFIRMED' | 'ACTIVE' | 'PAUSED' | 'CLOSED';

export interface Subscription {
  id: string;
  subscriptionNumber: string;
  customerId: string;
  customerName?: string;
  planId: string;
  planName?: string;
  billingFrequency: BillingFrequency;
  startDate: string;
  expiryDate: string;
  nextBillingDate?: string;
  paymentTerms?: string;
  taxRuleId?: string;
  discountCode?: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  status: SubscriptionStatus;
  createdAt: string;
}

export interface SubscriptionLine {
  id: string;
  subscriptionId: string; // Can reference quotationId or subscriptionId
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'PAID';
export type InvoicePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  idempotencyKey: string;
  subscriptionId: string;
  subscriptionNumber?: string;
  customerId: string;
  customerName?: string;
  billingPeriodKey?: string;
  invoiceDate: string;
  dueDate: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
  amountPaidPaise: number;
  balanceDuePaise: number;
  status: InvoiceStatus;
  paymentStatus: InvoicePaymentStatus;
  createdAt: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  productId: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export type TaxType = 'GST' | 'IGST' | 'CGST_SGST' | 'VAT' | 'CUSTOM';

export interface TaxRule {
  id: string;
  name: string;
  percentageBasisPoints: number; // e.g. 1800 = 18.00%
  taxType: TaxType;
  effectiveStartDate: string;
  effectiveEndDate?: string;
  status: AccountStatus;
  createdAt: string;
}

export type DiscountType = 'PERCENTAGE' | 'FIXED_PAISE';
export type DiscountScope = 'SUBSCRIPTION_WIDE' | 'PRODUCT_SPECIFIC';

export interface DiscountRule {
  id: string;
  name: string;
  code: string;
  discountType: DiscountType;
  value: number; // If PERCENTAGE: basis points (e.g. 1000 = 10.00%). If FIXED_PAISE: paise (e.g. 50000 = ₹500.00)
  minPurchasePaise: number;
  minQuantity: number;
  startDate: string;
  endDate?: string;
  maxUsageCount: number;
  usedCount: number;
  scope: DiscountScope;
  applicableProductIds?: string[];
  status: AccountStatus;
  createdAt: string;
}

export type PaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'CASH' | 'CARD' | 'OTHER';

export interface Payment {
  id: string;
  paymentNumber: string;
  customerId: string;
  customerName?: string;
  invoiceId: string;
  invoiceNumber?: string;
  paymentMethod: PaymentMethod;
  amountPaise: number;
  paymentDate: string;
  transactionReference: string;
  notes?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'SYSTEM';
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export interface DatabaseState {
  users: User[];
  customers: Customer[];
  staff: Staff[];
  products: Product[];
  productVariants: ProductVariant[];
  plans: Plan[];
  quotationTemplates: QuotationTemplate[];
  quotations: Quotation[];
  subscriptions: Subscription[];
  subscriptionLines: SubscriptionLine[];
  invoices: Invoice[];
  invoiceLines: InvoiceLine[];
  taxRules: TaxRule[];
  discountRules: DiscountRule[];
  payments: Payment[];
  auditLogs: AuditLog[];
}
