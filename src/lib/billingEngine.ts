import {
  BillingFrequency,
  DiscountRule,
  Invoice,
  InvoiceLine,
  Payment,
  Product,
  ProductVariant,
  Subscription,
  SubscriptionLine,
  SubscriptionStatus,
  TaxRule,
} from '../types/domain';

/**
 * Convert Rupees (number or string) to integer Paise (minor currency unit)
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) return 0;
  return Math.round(rupees * 100);
}

/**
 * Convert integer Paise to Rupees
 */
export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * Format integer Paise into Indian Rupee string (e.g., ₹1,560.00 or ₹1,560)
 */
export function formatINR(paise: number, showDecimals = false): string {
  const roundedPaise = Math.round(paise);
  const rupees = roundedPaise / 100;
  const hasPaise = roundedPaise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals || hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Format ISO or YYYY-MM-DD date string into Indian standard DD/MM/YYYY format
 */
export function formatIndianDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Password Validation Policy:
 * - Longer than 8 characters (min 9 chars, or >= 8 with strict rules; prompt says "longer than 8 characters" -> > 8 or >= 8, let's check length > 8)
 * - Uppercase letter
 * - Lowercase letter
 * - Special character
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!password || password.length <= 8) {
    errors.push('Password must be longer than 8 characters (at least 9 characters).');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter (A-Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter (a-z).');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character (e.g., @, #, $, !, %).');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate unit price in paise for a product + optional variant
 * Example: Base price ₹1,000 (100000 paise) + Variant Odoo ₹560 (56000 paise) = ₹1,560 (156000 paise)
 */
export function calculateVariantUnitPricePaise(
  product: Pick<Product, 'salesPricePaise'>,
  variant?: Pick<ProductVariant, 'additionalPricePaise'> | null
): number {
  const base = Math.max(0, Math.round(product.salesPricePaise));
  const extra = variant ? Math.round(variant.additionalPricePaise) : 0;
  return Math.max(0, base + extra);
}

/**
 * Check if a TaxRule is eligible on a given reference date (YYYY-MM-DD)
 */
export function isTaxRuleEligible(tax: TaxRule, referenceDateStr: string): boolean {
  if (tax.status !== 'ACTIVE') return false;
  const ref = referenceDateStr.slice(0, 10);
  if (tax.effectiveStartDate && ref < tax.effectiveStartDate.slice(0, 10)) return false;
  if (tax.effectiveEndDate && ref > tax.effectiveEndDate.slice(0, 10)) return false;
  return true;
}

/**
 * Check if a DiscountRule is eligible for the given order lines and reference date
 */
export function evaluateDiscountRule(
  discount: DiscountRule,
  subtotalPaise: number,
  totalQuantity: number,
  productIds: string[],
  referenceDateStr: string
): { eligible: boolean; discountPaise: number; reason?: string } {
  if (discount.status !== 'ACTIVE') {
    return { eligible: false, discountPaise: 0, reason: 'Discount rule is inactive.' };
  }
  const ref = referenceDateStr.slice(0, 10);
  if (discount.startDate && ref < discount.startDate.slice(0, 10)) {
    return { eligible: false, discountPaise: 0, reason: 'Discount has not started yet.' };
  }
  if (discount.endDate && ref > discount.endDate.slice(0, 10)) {
    return { eligible: false, discountPaise: 0, reason: 'Discount has expired.' };
  }
  if (discount.usedCount >= discount.maxUsageCount) {
    return { eligible: false, discountPaise: 0, reason: 'Discount usage limit reached.' };
  }
  if (subtotalPaise < discount.minPurchasePaise) {
    return {
      eligible: false,
      discountPaise: 0,
      reason: `Minimum purchase of ${formatINR(discount.minPurchasePaise)} required.`,
    };
  }
  if (totalQuantity < discount.minQuantity) {
    return {
      eligible: false,
      discountPaise: 0,
      reason: `Minimum quantity of ${discount.minQuantity} required.`,
    };
  }
  if (
    discount.scope === 'PRODUCT_SPECIFIC' &&
    discount.applicableProductIds &&
    discount.applicableProductIds.length > 0
  ) {
    const hasMatch = productIds.some((pid) => discount.applicableProductIds!.includes(pid));
    if (!hasMatch) {
      return {
        eligible: false,
        discountPaise: 0,
        reason: 'No eligible products in line items for this discount.',
      };
    }
  }

  let discountPaise = 0;
  if (discount.discountType === 'PERCENTAGE') {
    // value is in basis points (e.g. 1000 = 10%)
    discountPaise = Math.round((subtotalPaise * discount.value) / 10000);
  } else {
    discountPaise = Math.round(discount.value);
  }

  discountPaise = Math.min(subtotalPaise, Math.max(0, discountPaise));
  return { eligible: true, discountPaise };
}

/**
 * Authoritative Server-Side Order / Quotation / Subscription Totals Calculator
 */
export function calculateDocumentTotals(params: {
  lines: Array<{ productId: string; quantity: number; unitPricePaise: number }>;
  taxRule?: TaxRule | null;
  discountRule?: DiscountRule | null;
  referenceDateStr: string;
}): {
  subtotalPaise: number;
  discountPaise: number;
  taxableAmountPaise: number;
  taxPaise: number;
  totalPaise: number;
  discountApplied: boolean;
  discountReason?: string;
} {
  let subtotalPaise = 0;
  let totalQuantity = 0;
  const productIds: string[] = [];

  for (const line of params.lines) {
    const qty = Math.max(1, Math.round(line.quantity));
    const unit = Math.max(0, Math.round(line.unitPricePaise));
    subtotalPaise += qty * unit;
    totalQuantity += qty;
    productIds.push(line.productId);
  }

  let discountPaise = 0;
  let discountApplied = false;
  let discountReason: string | undefined;

  if (params.discountRule) {
    const evalRes = evaluateDiscountRule(
      params.discountRule,
      subtotalPaise,
      totalQuantity,
      productIds,
      params.referenceDateStr
    );
    discountPaise = evalRes.discountPaise;
    discountApplied = evalRes.eligible;
    discountReason = evalRes.reason;
  }

  const taxableAmountPaise = Math.max(0, subtotalPaise - discountPaise);

  let taxPaise = 0;
  if (params.taxRule && isTaxRuleEligible(params.taxRule, params.referenceDateStr)) {
    taxPaise = Math.round((taxableAmountPaise * params.taxRule.percentageBasisPoints) / 10000);
  }

  const totalPaise = taxableAmountPaise + taxPaise;

  return {
    subtotalPaise,
    discountPaise,
    taxableAmountPaise,
    taxPaise,
    totalPaise,
    discountApplied,
    discountReason,
  };
}

/**
 * Enforce Valid Subscription Status Transitions
 * Lifecycle: DRAFT -> QUOTATION -> CONFIRMED -> ACTIVE <-> PAUSED -> CLOSED
 */
export function isValidSubscriptionTransition(
  current: SubscriptionStatus,
  next: SubscriptionStatus
): boolean {
  if (current === next) return true;
  const allowed: Record<SubscriptionStatus, SubscriptionStatus[]> = {
    DRAFT: ['QUOTATION', 'CONFIRMED', 'ACTIVE', 'CLOSED'],
    QUOTATION: ['CONFIRMED', 'ACTIVE', 'CLOSED'],
    CONFIRMED: ['ACTIVE', 'CLOSED'],
    ACTIVE: ['PAUSED', 'CLOSED'],
    PAUSED: ['ACTIVE', 'CLOSED'],
    CLOSED: [], // Terminal state unless Admin override
  };
  return allowed[current]?.includes(next) ?? false;
}

/**
 * Compute next billing date based on billing frequency
 */
export function advanceBillingDate(dateStr: string, frequency: BillingFrequency): string {
  const base = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(base.getTime())) return dateStr;
  if (frequency === 'DAILY') {
    base.setUTCDate(base.getUTCDate() + 1);
  } else if (frequency === 'WEEKLY') {
    base.setUTCDate(base.getUTCDate() + 7);
  } else if (frequency === 'MONTHLY') {
    base.setUTCMonth(base.getUTCMonth() + 1);
  } else if (frequency === 'YEARLY') {
    base.setUTCFullYear(base.getUTCFullYear() + 1);
  }
  return base.toISOString().slice(0, 10);
}

/**
 * Reliable Idempotent Batch Invoice Generation Engine
 * - Evaluates all ACTIVE subscriptions due on or before `billingDateStr`
 * - Uses deterministic `idempotencyKey = "${sub.id}_${periodKey}"`
 * - Never generates duplicate invoices for the same subscription and billing period
 * - Enforces discount usage limits across concurrent/batch runs
 */
export function runBatchInvoiceGeneration(params: {
  subscriptions: Subscription[];
  subscriptionLines: SubscriptionLine[];
  existingInvoices: Invoice[];
  taxRules: TaxRule[];
  discountRules: DiscountRule[];
  billingDateStr: string;
}): {
  generatedInvoices: Invoice[];
  generatedInvoiceLines: InvoiceLine[];
  updatedSubscriptions: Subscription[];
  updatedDiscountRules: DiscountRule[];
  skippedDuplicateCount: number;
} {
  const existingKeys = new Set(params.existingInvoices.map((inv) => inv.idempotencyKey));
  const generatedInvoices: Invoice[] = [];
  const generatedInvoiceLines: InvoiceLine[] = [];
  const updatedSubscriptions: Subscription[] = [];
  const discountMap = new Map<string, DiscountRule>(
    params.discountRules.map((d) => [d.code.toUpperCase(), { ...d }])
  );
  let skippedDuplicateCount = 0;

  let seq = params.existingInvoices.length + 1;

  for (const sub of params.subscriptions) {
    if (sub.status !== 'ACTIVE') continue;
    const dueBillingDate = (sub.nextBillingDate || sub.startDate).slice(0, 10);
    const targetDate = params.billingDateStr.slice(0, 10);
    const directKey = `${sub.id}_${targetDate}`;

    if (existingKeys.has(directKey)) {
      skippedDuplicateCount++;
      continue;
    }

    if (dueBillingDate > targetDate) {
      // Check if an invoice was already generated for this subscription on targetDate
      const alreadyInvoicedToday = params.existingInvoices.some(
        (inv) => inv.subscriptionId === sub.id && inv.invoiceDate.slice(0, 10) === targetDate
      );
      if (alreadyInvoicedToday) {
        skippedDuplicateCount++;
      }
      continue;
    }

    const periodKey = dueBillingDate;
    const idempotencyKey = `${sub.id}_${periodKey}`;

    if (existingKeys.has(idempotencyKey)) {
      skippedDuplicateCount++;
      continue;
    }

    const subLines = params.subscriptionLines.filter((l) => l.subscriptionId === sub.id);
    const taxRule = sub.taxRuleId
      ? params.taxRules.find((t) => t.id === sub.taxRuleId) || null
      : params.taxRules.find((t) => t.status === 'ACTIVE') || null;
    const discountRule = sub.discountCode
      ? discountMap.get(sub.discountCode.toUpperCase()) || null
      : null;

    const lineInputs =
      subLines.length > 0
        ? subLines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPricePaise: l.unitPricePaise,
          }))
        : [
            {
              productId: sub.planId,
              quantity: 1,
              unitPricePaise: sub.subtotalPaise,
            },
          ];

    const totals = calculateDocumentTotals({
      lines: lineInputs,
      taxRule,
      discountRule,
      referenceDateStr: params.billingDateStr,
    });

    if (totals.discountApplied && discountRule) {
      discountRule.usedCount += 1;
    }

    const invoiceId = `inv_${sub.id}_${periodKey.replace(/-/g, '')}`;
    const invoiceNumber = `INV-2026-${String(seq++).padStart(4, '0')}`;

    const dueDateObj = new Date(params.billingDateStr + 'T00:00:00Z');
    dueDateObj.setUTCDate(dueDateObj.getUTCDate() + 15);
    const dueDate = dueDateObj.toISOString().slice(0, 10);

    const newInvoice: Invoice = {
      id: invoiceId,
      invoiceNumber,
      idempotencyKey,
      subscriptionId: sub.id,
      subscriptionNumber: sub.subscriptionNumber,
      customerId: sub.customerId,
      customerName: sub.customerName,
      billingPeriodKey: periodKey,
      invoiceDate: params.billingDateStr.slice(0, 10),
      dueDate,
      subtotalPaise: totals.subtotalPaise,
      discountPaise: totals.discountPaise,
      taxPaise: totals.taxPaise,
      grandTotalPaise: totals.totalPaise,
      amountPaidPaise: 0,
      balanceDuePaise: totals.totalPaise,
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      createdAt: new Date().toISOString(),
    };

    existingKeys.add(idempotencyKey);
    generatedInvoices.push(newInvoice);

    if (subLines.length > 0) {
      subLines.forEach((sl, idx) => {
        generatedInvoiceLines.push({
          id: `invline_${invoiceId}_${idx + 1}`,
          invoiceId,
          productId: sl.productId,
          description: sl.variantLabel
            ? `${sl.productName} (${sl.variantLabel})`
            : sl.productName,
          quantity: sl.quantity,
          unitPricePaise: sl.unitPricePaise,
          lineTotalPaise: sl.lineTotalPaise,
        });
      });
    } else {
      generatedInvoiceLines.push({
        id: `invline_${invoiceId}_1`,
        invoiceId,
        productId: sub.planId,
        description: `${sub.planName || 'Subscription Plan'} (${sub.billingFrequency})`,
        quantity: 1,
        unitPricePaise: totals.subtotalPaise,
        lineTotalPaise: totals.subtotalPaise,
      });
    }

    updatedSubscriptions.push({
      ...sub,
      nextBillingDate: advanceBillingDate(dueBillingDate, sub.billingFrequency),
    });
  }

  return {
    generatedInvoices,
    generatedInvoiceLines,
    updatedSubscriptions,
    updatedDiscountRules: Array.from(discountMap.values()),
    skippedDuplicateCount,
  };
}

/**
 * Apply a payment to an invoice, preventing overpayment, draft payments, and duplicate transaction references
 */
export function applyPaymentToInvoice(
  invoice: Invoice,
  paymentAmountPaise: number,
  referenceDateStr: string = new Date().toISOString().slice(0, 10),
  options?: {
    existingPayments?: Payment[];
    transactionReference?: string;
  }
): {
  valid: boolean;
  error?: string;
  isDuplicate?: boolean;
  updatedInvoice?: Invoice;
} {
  if (invoice.status === 'DRAFT') {
    return {
      valid: false,
      error: 'Cannot record a payment against a DRAFT invoice. Confirm the invoice first.',
    };
  }
  const amount = Math.round(paymentAmountPaise);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, error: 'Payment amount must be greater than ₹0.' };
  }
  if (options?.transactionReference !== undefined) {
    const cleanRef = options.transactionReference.trim();
    if (!cleanRef) {
      return {
        valid: false,
        error: 'A verified transaction reference is required to confirm payment.',
      };
    }
    if (
      options.existingPayments &&
      options.existingPayments.some(
        (p) =>
          p.transactionReference.trim().toUpperCase() === cleanRef.toUpperCase() &&
          p.invoiceId === invoice.id
      )
    ) {
      return {
        valid: false,
        isDuplicate: true,
        error: `Duplicate payment prevented: Transaction reference "${cleanRef}" has already been processed for ${invoice.invoiceNumber}.`,
      };
    }
  }
  if (invoice.balanceDuePaise <= 0 || invoice.status === 'PAID') {
    return { valid: false, error: 'This invoice is already paid in full.' };
  }
  if (amount > invoice.balanceDuePaise) {
    return {
      valid: false,
      error: `Payment amount (${formatINR(amount, true)}) exceeds the outstanding balance of ${formatINR(invoice.balanceDuePaise, true)}. Overpayment is not permitted.`,
    };
  }

  const newPaid = invoice.amountPaidPaise + amount;
  const newBalance = invoice.grandTotalPaise - newPaid;
  const isFullyPaid = newBalance === 0;

  let paymentStatus: Invoice['paymentStatus'] = 'PARTIAL';
  if (isFullyPaid) {
    paymentStatus = 'PAID';
  } else if (invoice.dueDate < referenceDateStr) {
    paymentStatus = 'OVERDUE';
  }

  const updatedInvoice: Invoice = {
    ...invoice,
    amountPaidPaise: newPaid,
    balanceDuePaise: newBalance,
    status: isFullyPaid ? 'PAID' : 'CONFIRMED',
    paymentStatus,
  };

  return { valid: true, updatedInvoice };
}

/**
 * Compute upcoming subscription renewals and next billing notifications within a window (default 30 days)
 */
export function getUpcomingRenewals(
  subscriptions: Subscription[],
  referenceDateStr: string = new Date().toISOString().slice(0, 10),
  windowDays = 30
): Array<{
  subscription: Subscription;
  targetDate: string;
  daysUntilDue: number;
  eventType: 'BILLING_CYCLE' | 'CONTRACT_EXPIRY';
}> {
  const refTime = new Date(referenceDateStr.slice(0, 10) + 'T00:00:00Z').getTime();
  if (Number.isNaN(refTime)) return [];
  const msPerDay = 86_400_000;
  const results: Array<{
    subscription: Subscription;
    targetDate: string;
    daysUntilDue: number;
    eventType: 'BILLING_CYCLE' | 'CONTRACT_EXPIRY';
  }> = [];

  for (const sub of subscriptions) {
    if (sub.status !== 'ACTIVE') continue;
    const dueStr = (sub.nextBillingDate || sub.expiryDate).slice(0, 10);
    const dueTime = new Date(dueStr + 'T00:00:00Z').getTime();
    if (Number.isNaN(dueTime)) continue;
    const daysUntilDue = Math.round((dueTime - refTime) / msPerDay);
    if (daysUntilDue >= 0 && daysUntilDue <= windowDays) {
      results.push({
        subscription: sub,
        targetDate: dueStr,
        daysUntilDue,
        eventType: sub.nextBillingDate ? 'BILLING_CYCLE' : 'CONTRACT_EXPIRY',
      });
    }
  }

  return results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

/**
 * Normalize subscription recurring revenue to Monthly Recurring Revenue (MRR) and Annual Recurring Revenue (ARR) in Paise
 */
export function calculateRecurringMetrics(subscriptions: Subscription[]): {
  mrrPaise: number;
  arrPaise: number;
  activeCount: number;
} {
  let mrrPaise = 0;
  let activeCount = 0;

  for (const sub of subscriptions) {
    if (sub.status !== 'ACTIVE') continue;
    activeCount++;
    const netAmount = Math.max(0, sub.totalPaise);
    if (sub.billingFrequency === 'DAILY') {
      mrrPaise += Math.round(netAmount * 30);
    } else if (sub.billingFrequency === 'WEEKLY') {
      mrrPaise += Math.round((netAmount * 52) / 12);
    } else if (sub.billingFrequency === 'MONTHLY') {
      mrrPaise += netAmount;
    } else if (sub.billingFrequency === 'YEARLY') {
      mrrPaise += Math.round(netAmount / 12);
    }
  }

  return {
    mrrPaise,
    arrPaise: mrrPaise * 12,
    activeCount,
  };
}

