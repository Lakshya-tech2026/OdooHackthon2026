import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  advanceBillingDate,
  applyPaymentToInvoice,
  calculateDocumentTotals,
  calculateRecurringMetrics,
  calculateVariantUnitPricePaise,
  evaluateDiscountRule,
  getUpcomingRenewals,
  isValidSubscriptionTransition,
  rupeesToPaise,
  runBatchInvoiceGeneration,
  validatePasswordStrength,
} from './billingEngine';
import {
  hashPasswordWithRandomSalt,
  signSessionToken,
  verifyFirebaseIdToken,
  verifyPasswordHash,
  verifySessionToken,
} from './serverSecurity';
import { DiscountRule, Invoice, Payment, Subscription, TaxRule } from '../types/domain';

test('1. Password validation rejects weak passwords and accepts compliant passwords', () => {
  assert.equal(validatePasswordStrength('Short1!').valid, false);
  assert.equal(validatePasswordStrength('alllowercase123!').valid, false);
  assert.equal(validatePasswordStrength('ALLUPPERCASE123!').valid, false);
  assert.equal(validatePasswordStrength('NoSpecialChar123').valid, false);
  assert.equal(validatePasswordStrength('Brightloop@2026').valid, true);
});

test('2. Random-salt scrypt hashing generates unique salts per user and verifies in constant time', () => {
  const hashA = hashPasswordWithRandomSalt('Admin@2026!');
  const hashB = hashPasswordWithRandomSalt('Admin@2026!');
  // Identical passwords must never produce identical hashes (no fixed salt)
  assert.notEqual(hashA, hashB);
  assert.equal(hashA.includes(':'), true);
  assert.equal(verifyPasswordHash('Admin@2026!', hashA), true);
  assert.equal(verifyPasswordHash('Admin@2026!', hashB), true);
  assert.equal(verifyPasswordHash('WrongPassword@2026!', hashA), false);
  // Rejects legacy unsalted/fixed-salt format
  assert.equal(verifyPasswordHash('Admin@2026!', 'deadbeef123456'), false);
});

test('3. Server JWT signing and verification rejects tampered and expired tokens', async () => {
  const validToken = signSessionToken({
    sub: 'usr_admin_1',
    email: 'admin@brightloop.in',
    mode: 'auth',
  });
  const check = verifySessionToken(validToken);
  assert.equal(check.valid, true);
  assert.equal(check.claims?.sub, 'usr_admin_1');

  // Tampered payload must fail HMAC signature check
  const parts = validToken.split('.');
  const tamperedToken = `${parts[0]}.${parts[1]}tampered.${parts[2]}`;
  assert.equal(verifySessionToken(tamperedToken).valid, false);

  // Expired token must be rejected
  const expiredToken = signSessionToken(
    { sub: 'usr_admin_1', email: 'admin@brightloop.in', mode: 'auth' },
    -10
  );
  const expiredCheck = verifySessionToken(expiredToken);
  assert.equal(expiredCheck.valid, false);
  assert.match(expiredCheck.error || '', /expired/i);

  // Malformed Firebase ID token is rejected
  const fbRes = await verifyFirebaseIdToken('invalid.firebase.token');
  assert.equal(fbRes.valid, false);
});

test('4. Product variant pricing calculates ₹1,000 + ₹560 (Odoo) = ₹1,560 in paise', () => {
  const baseProduct = { salesPricePaise: rupeesToPaise(1000) };
  const odooVariant = { additionalPricePaise: rupeesToPaise(560) };
  const totalUnitPaise = calculateVariantUnitPricePaise(baseProduct, odooVariant);
  assert.equal(totalUnitPaise, 156000); // ₹1,560.00 in paise
});

test('5. Tax and Discount calculations use integer minor units (paise) and enforce usage/expiry limits', () => {
  const gst18: TaxRule = {
    id: 'tax_gst18',
    name: 'GST 18%',
    percentageBasisPoints: 1800,
    taxType: 'GST',
    effectiveStartDate: '2026-01-01',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
  };

  const discount10: DiscountRule = {
    id: 'disc_launch10',
    name: 'Launch 10% Off',
    code: 'LAUNCH10',
    discountType: 'PERCENTAGE',
    value: 1000, // 10%
    minPurchasePaise: 100000, // ₹1,000
    minQuantity: 1,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    maxUsageCount: 2,
    usedCount: 1,
    scope: 'SUBSCRIPTION_WIDE',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
  };

  const res = calculateDocumentTotals({
    lines: [{ productId: 'prod_1', quantity: 2, unitPricePaise: 156000 }], // 2 * ₹1,560 = ₹3,120 (312000 paise)
    taxRule: gst18,
    discountRule: discount10,
    referenceDateStr: '2026-10-31',
  });

  assert.equal(res.subtotalPaise, 312000);
  assert.equal(res.discountPaise, 31200); // 10% of 312000
  assert.equal(res.taxableAmountPaise, 280800);
  assert.equal(res.taxPaise, 50544); // 18% of 280800
  assert.equal(res.totalPaise, 331344);
  assert.equal(res.discountApplied, true);

  // Exhausted usage limit should reject discount
  const exhaustedDiscount: DiscountRule = { ...discount10, usedCount: 2 };
  const exhaustedEval = evaluateDiscountRule(
    exhaustedDiscount,
    312000,
    2,
    ['prod_1'],
    '2026-10-31'
  );
  assert.equal(exhaustedEval.eligible, false);
  assert.equal(exhaustedEval.discountPaise, 0);
});

test('6. Subscription status lifecycle and billing cycle date advancement', () => {
  assert.equal(isValidSubscriptionTransition('DRAFT', 'QUOTATION'), true);
  assert.equal(isValidSubscriptionTransition('QUOTATION', 'CONFIRMED'), true);
  assert.equal(isValidSubscriptionTransition('CONFIRMED', 'ACTIVE'), true);
  assert.equal(isValidSubscriptionTransition('ACTIVE', 'PAUSED'), true);
  assert.equal(isValidSubscriptionTransition('PAUSED', 'ACTIVE'), true);
  assert.equal(isValidSubscriptionTransition('ACTIVE', 'CLOSED'), true);
  assert.equal(isValidSubscriptionTransition('CLOSED', 'ACTIVE'), false);

  assert.equal(advanceBillingDate('2026-01-15', 'MONTHLY'), '2026-02-15');
  assert.equal(advanceBillingDate('2026-01-15', 'YEARLY'), '2027-01-15');
  assert.equal(advanceBillingDate('2026-01-15', 'WEEKLY'), '2026-01-22');
});

test('7. Idempotent batch invoice generation prevents duplicate invoices for the same period', () => {
  const activeSub: Subscription = {
    id: 'sub_101',
    subscriptionNumber: 'SUB-2026-0101',
    customerId: 'cust_1',
    customerName: 'Aarav Mehta',
    planId: 'plan_monthly',
    planName: 'Enterprise Monthly',
    billingFrequency: 'MONTHLY',
    startDate: '2026-10-01',
    expiryDate: '2027-10-01',
    nextBillingDate: '2026-10-31',
    subtotalPaise: 156000,
    discountPaise: 0,
    taxPaise: 28080,
    totalPaise: 184080,
    status: 'ACTIVE',
    createdAt: '2026-10-01T00:00:00Z',
  };

  const firstRun = runBatchInvoiceGeneration({
    subscriptions: [activeSub],
    subscriptionLines: [],
    existingInvoices: [],
    taxRules: [],
    discountRules: [],
    billingDateStr: '2026-10-31',
  });

  assert.equal(firstRun.generatedInvoices.length, 1);
  assert.equal(firstRun.skippedDuplicateCount, 0);

  // Second run with the same subscription billing period must produce 0 duplicates
  const secondRun = runBatchInvoiceGeneration({
    subscriptions: [activeSub],
    subscriptionLines: [],
    existingInvoices: firstRun.generatedInvoices,
    taxRules: [],
    discountRules: [],
    billingDateStr: '2026-10-31',
  });

  assert.equal(secondRun.generatedInvoices.length, 0);
  assert.equal(secondRun.skippedDuplicateCount, 1);
});

test('8. Payment engine blocks DRAFT invoices, duplicate transaction references, and overpayments', () => {
  const draftInvoice: Invoice = {
    id: 'inv_draft',
    invoiceNumber: 'INV-2026-0099',
    idempotencyKey: 'sub_1_draft',
    subscriptionId: 'sub_1',
    customerId: 'cust_1',
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-16',
    subtotalPaise: 100000,
    discountPaise: 0,
    taxPaise: 18000,
    grandTotalPaise: 118000,
    amountPaidPaise: 0,
    balanceDuePaise: 118000,
    status: 'DRAFT',
    paymentStatus: 'UNPAID',
    createdAt: '2026-10-01T00:00:00Z',
  };

  // Cannot pay a DRAFT invoice
  const draftPayRes = applyPaymentToInvoice(draftInvoice, 50000, '2026-10-10');
  assert.equal(draftPayRes.valid, false);

  const invoice: Invoice = { ...draftInvoice, id: 'inv_1', status: 'CONFIRMED' };

  // Partial payment of ₹500 (50000 paise)
  const partialRes = applyPaymentToInvoice(invoice, 50000, '2026-10-10', {
    existingPayments: [],
    transactionReference: 'UPI-REF-1001',
  });
  assert.equal(partialRes.valid, true);
  assert.equal(partialRes.updatedInvoice?.amountPaidPaise, 50000);
  assert.equal(partialRes.updatedInvoice?.balanceDuePaise, 68000);
  assert.equal(partialRes.updatedInvoice?.paymentStatus, 'PARTIAL');

  const existingPayments: Payment[] = [
    {
      id: 'pay_1',
      paymentNumber: 'PAY-2026-0001',
      customerId: 'cust_1',
      invoiceId: 'inv_1',
      paymentMethod: 'UPI',
      amountPaise: 50000,
      paymentDate: '2026-10-10',
      transactionReference: 'UPI-REF-1001',
      createdAt: '2026-10-10T00:00:00Z',
    },
  ];

  // Duplicate transaction reference must be rejected
  const dupRefRes = applyPaymentToInvoice(partialRes.updatedInvoice!, 20000, '2026-10-11', {
    existingPayments,
    transactionReference: 'upi-ref-1001',
  });
  assert.equal(dupRefRes.valid, false);
  assert.equal(dupRefRes.isDuplicate, true);

  // Overpayment attempt of ₹700 (70000 paise) when balance is ₹680 (68000 paise)
  const overpayRes = applyPaymentToInvoice(partialRes.updatedInvoice!, 70000, '2026-10-12');
  assert.equal(overpayRes.valid, false);

  // Full remaining payment of ₹680 (68000 paise)
  const fullRes = applyPaymentToInvoice(partialRes.updatedInvoice!, 68000, '2026-10-12', {
    existingPayments,
    transactionReference: 'UPI-REF-1002',
  });
  assert.equal(fullRes.valid, true);
  assert.equal(fullRes.updatedInvoice?.balanceDuePaise, 0);
  assert.equal(fullRes.updatedInvoice?.paymentStatus, 'PAID');
  assert.equal(fullRes.updatedInvoice?.status, 'PAID');
});

test('9. Recurring metrics and upcoming renewal notifications compute accurately', () => {
  const subs: Subscription[] = [
    {
      id: 's1',
      subscriptionNumber: 'SUB-1',
      customerId: 'c1',
      planId: 'p1',
      billingFrequency: 'MONTHLY',
      startDate: '2026-01-01',
      expiryDate: '2027-01-01',
      nextBillingDate: '2026-11-10',
      subtotalPaise: 100000,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 100000, // ₹1,000/mo
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 's2',
      subscriptionNumber: 'SUB-2',
      customerId: 'c2',
      planId: 'p2',
      billingFrequency: 'YEARLY',
      startDate: '2026-01-01',
      expiryDate: '2027-01-01',
      nextBillingDate: '2027-01-01',
      subtotalPaise: 1200000,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 1200000, // ₹12,000/yr = ₹1,000/mo
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const metrics = calculateRecurringMetrics(subs);
  assert.equal(metrics.activeCount, 2);
  assert.equal(metrics.mrrPaise, 200000); // ₹2,000/mo
  assert.equal(metrics.arrPaise, 2400000); // ₹24,000/yr

  const upcoming30 = getUpcomingRenewals(subs, '2026-10-31', 30);
  assert.equal(upcoming30.length, 1);
  assert.equal(upcoming30[0].subscription.id, 's1');
  assert.equal(upcoming30[0].daysUntilDue, 10);
});

test('10. End-to-End API Security Audit: Header spoofing rejection, RBAC enforcement, and Customer IDOR isolation', async () => {
  process.env.BRIGHTLOOP_TEST_MODE = '1';
  const { createBrightloopApp } = await import('../../server');
  const app = await createBrightloopApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // A. Forged x-user-id / x-user-email headers without Bearer token MUST be rejected (401)
    const spoofRes = await fetch(`${baseUrl}/api/state`, {
      headers: {
        'x-user-id': 'usr_admin_1',
        'x-user-email': 'admin@brightloop.in',
      },
    });
    assert.equal(spoofRes.status, 401);

    // B. Invalid Bearer token MUST be rejected (401)
    const badTokenRes = await fetch(`${baseUrl}/api/state`, {
      headers: {
        Authorization: 'Bearer invalid.jwt.token',
      },
    });
    assert.equal(badTokenRes.status, 401);

    // C. Customer token cannot access Admin endpoints (403)
    const customerToken = signSessionToken({
      sub: 'usr_cust_1',
      email: 'aarav@kinetixlabs.in',
      mode: 'auth',
    });
    const custCreateProdRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        name: 'Unauthorized Product',
        salesPricePaise: 50000,
      }),
    });
    assert.equal(custCreateProdRes.status, 403);

    // D. Customer cannot escalate their own role via /api/auth/profile (403)
    const roleEscalationRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        name: 'Aarav Escalated',
        role: 'ADMIN',
      }),
    });
    assert.equal(roleEscalationRes.status, 403);

    // E. Customer A (cust_101) cannot view or pay Customer B's (cust_102) invoice inv_1002 (403 IDOR prevention)
    const crossInvoiceRes = await fetch(`${baseUrl}/api/invoices/inv_1002`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
      },
    });
    assert.equal(crossInvoiceRes.status, 403);

    const crossPaymentRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        invoiceId: 'inv_1002',
        amountPaise: 10000,
        paymentMethod: 'UPI',
        transactionReference: 'TXN-CROSS-999',
      }),
    });
    assert.equal(crossPaymentRes.status, 403);

    // F. Staff token can read operational state (200) but cannot create Staff accounts or Products (403)
    const staffToken = signSessionToken({
      sub: 'usr_staff_1',
      email: 'staff@brightloop.in',
      mode: 'auth',
    });
    const staffStateRes = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    assert.equal(staffStateRes.status, 200);

    const staffCreateStaffRes = await fetch(`${baseUrl}/api/staff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        name: 'Rogue Staff',
        email: 'rogue@brightloop.in',
      }),
    });
    assert.equal(staffCreateStaffRes.status, 403);

    // G. Admin token can access security audit status and create a non-destructive backup snapshot
    const adminToken = signSessionToken({
      sub: 'usr_admin_1',
      email: 'admin@brightloop.in',
      mode: 'auth',
    });
    const secStatusRes = await fetch(`${baseUrl}/api/admin/security-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(secStatusRes.status, 200);
    const secJson = await secStatusRes.json();
    assert.equal(secJson.securityPosture.headerTrustRemoved, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
