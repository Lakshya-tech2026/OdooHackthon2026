import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  RefreshCw,
  Search,
  Printer,
  CreditCard,
  Plus,
  Percent,
  CheckCircle2,
  Mail,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatINR, formatIndianDate, rupeesToPaise } from '../lib/billingEngine';
import { Invoice, PaymentMethod, TaxType } from '../types/domain';

export const InvoicesPaymentsView: React.FC<{
  initialTab?: 'INVOICES' | 'PAYMENTS' | 'TAXES_DISCOUNTS';
}> = ({ initialTab = 'INVOICES' }) => {
  const { dbState, currentUser, apiRequest, refreshState } = useApp();
  const isAdmin = currentUser?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'INVOICES' | 'PAYMENTS' | 'TAXES_DISCOUNTS'>(
    initialTab
  );

  // Batch Billing Engine State
  const [billingDate, setBillingDate] = useState('2026-10-31');
  const [batchRunning, setBatchRunning] = useState(false);
  const [lastBatchResult, setLastBatchResult] = useState<{
    generatedCount: number;
    skippedDuplicateCount: number;
  } | null>(null);

  // Invoices Filter State
  const [invSearch, setInvSearch] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState<string>('ALL');

  // PDF Invoice Preview Modal
  const [selectedInvoiceForPdf, setSelectedInvoiceForPdf] = useState<Invoice | null>(null);

  // Record Payment Modal
  const [paymentTargetInvoice, setPaymentTargetInvoice] = useState<Invoice | null>(null);
  const [payAmountRupees, setPayAmountRupees] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState('2026-10-31');
  const [payNotes, setPayNotes] = useState('');

  // Payments Search & Filter
  const [paySearch, setPaySearch] = useState('');
  const [payMethodFilter, setPayMethodFilter] = useState<string>('ALL');

  // Tax Modal State
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [taxName, setTaxName] = useState('');
  const [taxPercent, setTaxPercent] = useState('18');
  const [taxType, setTaxType] = useState<TaxType>('GST');
  const [taxStart, setTaxStart] = useState('2026-01-01');
  const [taxEnd, setTaxEnd] = useState('2028-12-31');

  // Discount Modal State
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discName, setDiscName] = useState('');
  const [discCode, setDiscCode] = useState('');
  const [discType, setDiscType] = useState<'PERCENTAGE' | 'FIXED_PAISE'>('PERCENTAGE');
  const [discValInput, setDiscValInput] = useState('10');
  const [discMinPurchaseRupees, setDiscMinPurchaseRupees] = useState('1000');
  const [discMinQty, setDiscMinQty] = useState('1');
  const [discMaxUsage, setDiscMaxUsage] = useState('50');
  const [discStart, setDiscStart] = useState('2026-01-01');
  const [discEnd, setDiscEnd] = useState('2027-12-31');

  const filteredInvoices = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return dbState.invoices.filter((inv) => {
      if (
        invStatusFilter !== 'ALL' &&
        inv.status !== invStatusFilter &&
        inv.paymentStatus !== invStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.customerName || '').toLowerCase().includes(q) ||
        (inv.subscriptionNumber || '').toLowerCase().includes(q)
      );
    });
  }, [dbState.invoices, invSearch, invStatusFilter]);

  const filteredPayments = useMemo(() => {
    const q = paySearch.trim().toLowerCase();
    return dbState.payments.filter((p) => {
      if (payMethodFilter !== 'ALL' && p.paymentMethod !== payMethodFilter) return false;
      if (!q) return true;
      return (
        p.paymentNumber.toLowerCase().includes(q) ||
        (p.customerName || '').toLowerCase().includes(q) ||
        (p.invoiceNumber || '').toLowerCase().includes(q) ||
        p.transactionReference.toLowerCase().includes(q)
      );
    });
  }, [dbState.payments, paySearch, payMethodFilter]);

  const handleRunBatchInvoices = async () => {
    setBatchRunning(true);
    const res = await apiRequest<{
      generatedCount: number;
      skippedDuplicateCount: number;
    }>('/api/invoices/generate-batch', {
      method: 'POST',
      body: JSON.stringify({ billingDate }),
    });
    setBatchRunning(false);
    if (!res.ok || !res.data) {
      toast.error(res.error || 'Batch invoice run failed.');
      return;
    }
    setLastBatchResult(res.data);
    if (res.data.generatedCount > 0) {
      toast.success(
        `Generated ${res.data.generatedCount} due invoice(s)! (${res.data.skippedDuplicateCount} duplicates skipped)`
      );
    } else {
      toast.info(
        `0 new invoices generated. ${res.data.skippedDuplicateCount} already-billed period(s) skipped by idempotency guard.`
      );
    }
    await refreshState();
  };

  const openRecordPayment = (inv: Invoice) => {
    setPaymentTargetInvoice(inv);
    setPayAmountRupees(String((inv.balanceDuePaise / 100).toFixed(2)));
    setPayMethod('UPI');
    setPayRef(`UPI/${Date.now().toString().slice(-8)}/AXIS`);
    setPayDate('2026-10-31');
    setPayNotes('');
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentTargetInvoice) return;
    const amountPaise = rupeesToPaise(Number(payAmountRupees));
    const res = await apiRequest('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoiceId: paymentTargetInvoice.id,
        paymentMethod: payMethod,
        amountPaise,
        paymentDate: payDate,
        transactionReference: payRef,
        notes: payNotes,
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Payment rejected.');
      return;
    }
    toast.success(
      `Recorded ${payMethod} payment of ${formatINR(amountPaise, true)} for ${paymentTargetInvoice.invoiceNumber}!`
    );
    setPaymentTargetInvoice(null);
    await refreshState();
  };

  const handleCreateTax = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/taxes', {
      method: 'POST',
      body: JSON.stringify({
        name: taxName.trim(),
        percentageBasisPoints: Math.round(Number(taxPercent) * 100),
        taxType,
        effectiveStartDate: taxStart,
        effectiveEndDate: taxEnd,
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not create tax rule.');
      return;
    }
    toast.success(`Created tax rule "${taxName}".`);
    setShowTaxModal(false);
    setTaxName('');
    await refreshState();
  };

  const handleCreateDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    const value =
      discType === 'PERCENTAGE'
        ? Math.round(Number(discValInput) * 100)
        : rupeesToPaise(Number(discValInput));
    const res = await apiRequest('/api/discounts', {
      method: 'POST',
      body: JSON.stringify({
        name: discName.trim(),
        code: discCode.trim().toUpperCase(),
        discountType: discType,
        value,
        minPurchasePaise: rupeesToPaise(Number(discMinPurchaseRupees || 0)),
        minQuantity: Number(discMinQty || 1),
        maxUsageCount: Number(discMaxUsage || 100),
        startDate: discStart,
        endDate: discEnd,
        scope: 'SUBSCRIPTION_WIDE',
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not create discount rule.');
      return;
    }
    toast.success(`Created discount rule "${discCode.toUpperCase()}".`);
    setShowDiscountModal(false);
    setDiscName('');
    setDiscCode('');
    await refreshState();
  };

  return (
    <div className="space-y-6">
      {/* Header & Section Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Automated Invoicing, Payments, Taxes & Discounts
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Idempotent batch billing, GST compliance, partial/full payment settlement, and PDF
            invoices
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('INVOICES')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'INVOICES'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Invoices ({dbState.invoices.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PAYMENTS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'PAYMENTS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Payments ({dbState.payments.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TAXES_DISCOUNTS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'TAXES_DISCOUNTS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Taxes & Discounts ({dbState.taxRules.length + dbState.discountRules.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'INVOICES' && (
        <div className="space-y-5">
          {/* Reliable Idempotent Batch Billing Engine Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Automated Batch Invoice Generation Engine
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Scans all active subscriptions due on or before the target billing date. Enforces{' '}
                <code className="font-mono text-indigo-600">
                  idempotencyKey = subscriptionId_billingPeriod
                </code>{' '}
                to guarantee zero duplicate invoices.
              </p>
              {lastBatchResult && (
                <div
                  data-testid="batch-billing-result"
                  className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-emerald-700"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Last Batch Run: {lastBatchResult.generatedCount} new invoice(s) generated ·{' '}
                    {lastBatchResult.skippedDuplicateCount} duplicate period(s) prevented.
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div>
                <label htmlFor="batch-date" className="block text-[11px] text-slate-500 mb-1">
                  Target Billing Date
                </label>
                <input
                  id="batch-date"
                  type="date"
                  value={billingDate}
                  onChange={(e) => setBillingDate(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="button"
                onClick={handleRunBatchInvoices}
                disabled={batchRunning}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${batchRunning ? 'animate-spin' : ''}`} />
                <span>{batchRunning ? 'Processing Batch...' : 'Run Batch Billing Engine'}</span>
              </button>
            </div>
          </div>

          {/* Search & Status Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search invoices"
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                placeholder="Search by invoice #, subscription #, or customer..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
              {['ALL', 'PAID', 'PARTIAL', 'UNPAID', 'OVERDUE'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setInvStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    invStatusFilter === st
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Invoices Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Invoice # · Period Key</th>
                    <th className="py-3 px-4">Customer · Contract</th>
                    <th className="py-3 px-4">Invoice · Due Date</th>
                    <th className="py-3 px-4 text-right">Grand Total</th>
                    <th className="py-3 px-4 text-right">Paid · Balance Due</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-slate-900">
                          {inv.invoiceNumber}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          Key: {inv.idempotencyKey}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{inv.customerName}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {inv.subscriptionNumber}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-[11px] text-slate-600">
                        <div>Issued: {formatIndianDate(inv.invoiceDate)}</div>
                        <div>Due: {formatIndianDate(inv.dueDate)}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatINR(inv.grandTotalPaise, true)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[11px]">
                        <div className="text-emerald-700">
                          Paid: {formatINR(inv.amountPaidPaise, true)}
                        </div>
                        <div
                          className={
                            inv.balanceDuePaise > 0
                              ? 'font-bold text-red-700'
                              : 'text-slate-400'
                          }
                        >
                          Due: {formatINR(inv.balanceDuePaise, true)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-semibold">
                        <span
                          className={
                            inv.paymentStatus === 'PAID'
                              ? 'text-emerald-700'
                              : inv.paymentStatus === 'PARTIAL'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }
                        >
                          {inv.status} · {inv.paymentStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {inv.balanceDuePaise > 0 && (
                            <button
                              type="button"
                              onClick={() => openRecordPayment(inv)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded inline-flex items-center gap-1"
                            >
                              <CreditCard className="w-3 h-3" />
                              <span>Record Payment</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedInvoiceForPdf(inv)}
                            className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 border border-slate-300 rounded inline-flex items-center gap-1"
                          >
                            <Printer className="w-3 h-3" />
                            <span>PDF / Print</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              toast.success(
                                `Invoice ${inv.invoiceNumber} queued for email delivery to ${inv.customerName}.`
                              )
                            }
                            aria-label={`Email invoice ${inv.invoiceNumber}`}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 rounded hover:bg-slate-100"
                            title="Email Invoice"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'PAYMENTS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search payments"
                value={paySearch}
                onChange={(e) => setPaySearch(e.target.value)}
                placeholder="Search payments by reference, invoice #, or customer..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <select
              aria-label="Filter payment method"
              value={payMethodFilter}
              onChange={(e) => setPayMethodFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="ALL">All Payment Methods</option>
              <option value="UPI">UPI</option>
              <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
              <option value="CARD">Card</option>
              <option value="CASH">Cash</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Payment ID</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Invoice Reference</th>
                    <th className="py-3 px-4">Method · Transaction Ref</th>
                    <th className="py-3 px-4">Payment Date</th>
                    <th className="py-3 px-4 text-right">Amount Settled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredPayments.map((pay) => (
                    <tr key={pay.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {pay.paymentNumber}
                      </td>
                      <td className="py-3.5 px-4 text-slate-800 font-medium">{pay.customerName}</td>
                      <td className="py-3.5 px-4 font-mono text-indigo-700">{pay.invoiceNumber}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-800">{pay.paymentMethod}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono text-slate-500">{pay.transactionReference}</span>
                        {pay.notes && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{pay.notes}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600">
                        {formatIndianDate(pay.paymentDate)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                        {formatINR(pay.amountPaise, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'TAXES_DISCOUNTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tax Rules Card */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Tax Rules Engine (Backend)</h2>
                <p className="text-xs text-slate-500">
                  GST, IGST, and VAT rules applied automatically on quotations & invoices
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowTaxModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Tax Rule</span>
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-200 text-xs">
              {dbState.taxRules.map((tax) => (
                <div key={tax.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{tax.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      Type: {tax.taxType} · Effective: {formatIndianDate(tax.effectiveStartDate)} to{' '}
                      {formatIndianDate(tax.effectiveEndDate)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-sm text-indigo-700">
                      {(tax.percentageBasisPoints / 100).toFixed(2)}%
                    </div>
                    <div className="text-[11px] text-emerald-700 font-medium">{tax.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Discount Rules Card */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Discount Rules & Usage Caps (Admin Only)
                </h2>
                <p className="text-xs text-slate-500">
                  Enforces min purchase, min qty, expiry, and atomic usage counters
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowDiscountModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg inline-flex items-center gap-1"
                >
                  <Percent className="w-3.5 h-3.5" />
                  <span>Add Discount</span>
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-200 text-xs">
              {dbState.discountRules.map((disc) => (
                <div key={disc.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-700">{disc.code}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-slate-900">{disc.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      Min Purchase: {formatINR(disc.minPurchasePaise)} · Min Qty: {disc.minQuantity}{' '}
                      · Valid until {formatIndianDate(disc.endDate)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-sm text-emerald-700">
                      {disc.discountType === 'PERCENTAGE'
                        ? `${(disc.value / 100).toFixed(0)}% OFF`
                        : `${formatINR(disc.value)} OFF`}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      Used: {disc.usedCount} / {disc.maxUsageCount}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentTargetInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Record Payment · {paymentTargetInvoice.invoiceNumber}
            </h3>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-900">
                  {paymentTargetInvoice.customerName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Grand Total:</span>
                <span className="font-mono">
                  {formatINR(paymentTargetInvoice.grandTotalPaise, true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Outstanding Balance Due:</span>
                <span className="font-mono font-bold text-red-700">
                  {formatINR(paymentTargetInvoice.balanceDuePaise, true)}
                </span>
              </div>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pay-amt" className="block text-xs font-medium text-slate-700 mb-1">
                    Amount to Record (₹) *
                  </label>
                  <input
                    id="pay-amt"
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={payAmountRupees}
                    onChange={(e) => setPayAmountRupees(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pay-method"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Payment Method
                  </label>
                  <select
                    id="pay-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                    <option value="CARD">CARD</option>
                    <option value="CASH">CASH</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pay-ref" className="block text-xs font-medium text-slate-700 mb-1">
                    Transaction Reference *
                  </label>
                  <input
                    id="pay-ref"
                    type="text"
                    required
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pay-date"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Payment Date
                  </label>
                  <input
                    id="pay-date"
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="pay-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Notes (Optional)
                </label>
                <input
                  id="pay-notes"
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Partial or full settlement notes"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentTargetInvoice(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable PDF Invoice Modal */}
      {selectedInvoiceForPdf && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-8 space-y-6 my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  Tax Invoice Preview · {selectedInvoiceForPdf.invoiceNumber}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / Save PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceForPdf(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>

            <div id="printable-invoice" className="space-y-6 text-xs text-slate-800">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xl font-bold text-slate-900">Brightloop SaaS India</div>
                  <div className="text-slate-500 mt-0.5">
                    GSTIN: 27AABCB2026F1Z1 · BKC, Mumbai, Maharashtra 400051
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold font-mono text-indigo-700">
                    {selectedInvoiceForPdf.invoiceNumber}
                  </div>
                  <div className="font-mono text-slate-500">
                    Issued: {formatIndianDate(selectedInvoiceForPdf.invoiceDate)} · Due:{' '}
                    {formatIndianDate(selectedInvoiceForPdf.dueDate)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="text-[11px] font-semibold text-slate-400">Billed To</div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    {selectedInvoiceForPdf.customerName}
                  </div>
                  <div className="text-slate-500 font-mono">
                    Customer ID: {selectedInvoiceForPdf.customerId}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-slate-400">
                    Subscription Reference
                  </div>
                  <div className="font-mono font-bold text-slate-900 mt-0.5">
                    {selectedInvoiceForPdf.subscriptionNumber}
                  </div>
                  <div className="font-mono text-slate-500">
                    Idempotency: {selectedInvoiceForPdf.idempotencyKey}
                  </div>
                </div>
              </div>

              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 text-[11px] font-semibold text-slate-500">
                    <th className="py-2">Description</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Unit Price</th>
                    <th className="py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {dbState.invoiceLines
                    .filter((l) => l.invoiceId === selectedInvoiceForPdf.id)
                    .map((line) => (
                      <tr key={line.id}>
                        <td className="py-2.5 font-medium text-slate-900">{line.description}</td>
                        <td className="py-2.5 text-right font-mono">{line.quantity}</td>
                        <td className="py-2.5 text-right font-mono">
                          {formatINR(line.unitPricePaise, true)}
                        </td>
                        <td className="py-2.5 text-right font-mono font-semibold">
                          {formatINR(line.lineTotalPaise, true)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              <div className="border-t border-slate-200 pt-4 space-y-1.5 max-w-xs ml-auto">
                <div className="flex justify-between">
                  <span className="text-slate-500">Subtotal:</span>
                  <span className="font-mono">
                    {formatINR(selectedInvoiceForPdf.subtotalPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Discount:</span>
                  <span className="font-mono">
                    -{formatINR(selectedInvoiceForPdf.discountPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">GST / Applicable Tax:</span>
                  <span className="font-mono">
                    +{formatINR(selectedInvoiceForPdf.taxPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span className="font-mono">
                    {formatINR(selectedInvoiceForPdf.grandTotalPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Amount Paid:</span>
                  <span className="font-mono">
                    {formatINR(selectedInvoiceForPdf.amountPaidPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-red-700">
                  <span>Balance Due:</span>
                  <span className="font-mono">
                    {formatINR(selectedInvoiceForPdf.balanceDuePaise, true)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Tax Rule Modal */}
      {showTaxModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Create Tax Rule</h3>
            <form onSubmit={handleCreateTax} className="space-y-3">
              <div>
                <label htmlFor="tx-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Tax Name *
                </label>
                <input
                  id="tx-name"
                  type="text"
                  required
                  value={taxName}
                  onChange={(e) => setTaxName(e.target.value)}
                  placeholder="Standard GST 18%"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="tx-pct" className="block text-xs font-medium text-slate-700 mb-1">
                    Tax Percentage (%) *
                  </label>
                  <input
                    id="tx-pct"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="tx-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Tax Type
                  </label>
                  <select
                    id="tx-type"
                    value={taxType}
                    onChange={(e) => setTaxType(e.target.value as TaxType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="GST">GST</option>
                    <option value="IGST">IGST</option>
                    <option value="CGST_SGST">CGST_SGST</option>
                    <option value="VAT">VAT</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="tx-start"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Effective Start
                  </label>
                  <input
                    id="tx-start"
                    type="date"
                    value={taxStart}
                    onChange={(e) => setTaxStart(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="tx-end" className="block text-xs font-medium text-slate-700 mb-1">
                    Effective End
                  </label>
                  <input
                    id="tx-end"
                    type="date"
                    value={taxEnd}
                    onChange={(e) => setTaxEnd(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTaxModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Save Tax Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Discount Rule Modal */}
      {showDiscountModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Create Discount Rule</h3>
            <form onSubmit={handleCreateDiscount} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dc-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Rule Name *
                  </label>
                  <input
                    id="dc-name"
                    type="text"
                    required
                    value={discName}
                    onChange={(e) => setDiscName(e.target.value)}
                    placeholder="Festive 20% Rebate"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="dc-code" className="block text-xs font-medium text-slate-700 mb-1">
                    Promo Code *
                  </label>
                  <input
                    id="dc-code"
                    type="text"
                    required
                    value={discCode}
                    onChange={(e) => setDiscCode(e.target.value)}
                    placeholder="DIWALI20"
                    className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dc-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Discount Type
                  </label>
                  <select
                    id="dc-type"
                    value={discType}
                    onChange={(e) =>
                      setDiscType(e.target.value as 'PERCENTAGE' | 'FIXED_PAISE')
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED_PAISE">Fixed Amount (₹)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="dc-val" className="block text-xs font-medium text-slate-700 mb-1">
                    {discType === 'PERCENTAGE' ? 'Percentage (%)' : 'Fixed Amount (₹)'} *
                  </label>
                  <input
                    id="dc-val"
                    type="number"
                    min="1"
                    required
                    value={discValInput}
                    onChange={(e) => setDiscValInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="dc-minp" className="block text-[11px] text-slate-600 mb-1">
                    Min Purchase (₹)
                  </label>
                  <input
                    id="dc-minp"
                    type="number"
                    min="0"
                    value={discMinPurchaseRupees}
                    onChange={(e) => setDiscMinPurchaseRupees(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="dc-minq" className="block text-[11px] text-slate-600 mb-1">
                    Min Qty
                  </label>
                  <input
                    id="dc-minq"
                    type="number"
                    min="1"
                    value={discMinQty}
                    onChange={(e) => setDiscMinQty(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="dc-maxu" className="block text-[11px] text-slate-600 mb-1">
                    Max Usages
                  </label>
                  <input
                    id="dc-maxu"
                    type="number"
                    min="1"
                    value={discMaxUsage}
                    onChange={(e) => setDiscMaxUsage(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dc-st" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="dc-st"
                    type="date"
                    value={discStart}
                    onChange={(e) => setDiscStart(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="dc-ed" className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="dc-ed"
                    type="date"
                    value={discEnd}
                    onChange={(e) => setDiscEnd(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDiscountModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Save Discount Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
