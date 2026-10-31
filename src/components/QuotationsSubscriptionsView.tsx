import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  FileText,
  History,
  CheckCircle2,
  FileSpreadsheet,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  calculateDocumentTotals,
  calculateVariantUnitPricePaise,
  formatINR,
  formatIndianDate,
} from '../lib/billingEngine';
import { Quotation, Subscription, SubscriptionStatus } from '../types/domain';

interface LineDraft {
  productId: string;
  variantId: string;
  quantity: number;
}

export const QuotationsSubscriptionsView: React.FC<{
  initialTab?: 'QUOTATIONS' | 'SUBSCRIPTIONS';
}> = ({ initialTab = 'SUBSCRIPTIONS' }) => {
  const { dbState, apiRequest, refreshState } = useApp();

  const [activeTab, setActiveTab] = useState<'QUOTATIONS' | 'SUBSCRIPTIONS'>(initialTab);

  // Subscriptions Table Filters
  const [subSearch, setSubSearch] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState<string>('ALL');
  const [subPage, setSubPage] = useState(1);
  const pageSize = 6;

  // Quotations Table Filters
  const [quoSearch, setQuoSearch] = useState('');
  const [quoStatusFilter, setQuoStatusFilter] = useState<string>('ALL');

  // Create Quotation / Subscription Modal
  const [showBuilderModal, setShowBuilderModal] = useState<'QUOTATION' | 'SUBSCRIPTION' | null>(
    null
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>(dbState.customers[0]?.id || 'cust_101');
  const [planId, setPlanId] = useState<string>(dbState.plans[0]?.id || 'plan_monthly_std');
  const [validityDays, setValidityDays] = useState<string>('15');
  const [taxRuleId, setTaxRuleId] = useState<string>(dbState.taxRules[0]?.id || 'tax_gst18');
  const [discountCode, setDiscountCode] = useState<string>('WELCOME10');
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([
    {
      productId: 'prod_101',
      variantId: 'var_101',
      quantity: 2,
    },
  ]);

  // Create Quotation Template Modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplPlanId, setTplPlanId] = useState(dbState.plans[0]?.id || 'plan_monthly_std');
  const [tplValidity, setTplValidity] = useState('15');
  const [tplDesc, setTplDesc] = useState('');

  // Audit History Modal
  const [historySub, setHistorySub] = useState<Subscription | null>(null);

  const filteredSubscriptions = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return dbState.subscriptions.filter((s) => {
      if (subStatusFilter !== 'ALL' && s.status !== subStatusFilter) return false;
      if (!q) return true;
      return (
        s.subscriptionNumber.toLowerCase().includes(q) ||
        (s.customerName || '').toLowerCase().includes(q) ||
        (s.planName || '').toLowerCase().includes(q)
      );
    });
  }, [dbState.subscriptions, subSearch, subStatusFilter]);

  const paginatedSubscriptions = useMemo(() => {
    const start = (subPage - 1) * pageSize;
    return filteredSubscriptions.slice(start, start + pageSize);
  }, [filteredSubscriptions, subPage]);

  const filteredQuotations = useMemo(() => {
    const q = quoSearch.trim().toLowerCase();
    return dbState.quotations.filter((quo) => {
      if (quoStatusFilter !== 'ALL' && quo.status !== quoStatusFilter) return false;
      if (!q) return true;
      return (
        quo.quotationNumber.toLowerCase().includes(q) ||
        (quo.customerName || '').toLowerCase().includes(q) ||
        (quo.planName || '').toLowerCase().includes(q)
      );
    });
  }, [dbState.quotations, quoSearch, quoStatusFilter]);

  // Live Preview Calculation for Modal
  const liveCalculation = useMemo(() => {
    const resolvedLines = lineDrafts.map((ld) => {
      const prod = dbState.products.find((p) => p.id === ld.productId) || dbState.products[0];
      const variant = ld.variantId
        ? dbState.productVariants.find((v) => v.id === ld.variantId)
        : null;
      const unitPricePaise = prod ? calculateVariantUnitPricePaise(prod, variant) : 0;
      return {
        productId: prod?.id || 'prod_101',
        quantity: Math.max(1, ld.quantity),
        unitPricePaise,
      };
    });

    const taxRule = dbState.taxRules.find((t) => t.id === taxRuleId) || null;
    const discountRule = discountCode.trim()
      ? dbState.discountRules.find(
          (d) => d.code.toUpperCase() === discountCode.trim().toUpperCase()
        ) || null
      : null;

    return calculateDocumentTotals({
      lines: resolvedLines,
      taxRule,
      discountRule,
      referenceDateStr: '2026-10-31',
    });
  }, [lineDrafts, taxRuleId, discountCode, dbState]);

  const applyQuotationTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = dbState.quotationTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    setPlanId(tpl.planId);
    setValidityDays(String(tpl.validityDays));
    if (tpl.defaultProductIds && tpl.defaultProductIds.length > 0) {
      setLineDrafts(
        tpl.defaultProductIds.map((pid) => {
          const firstVar = dbState.productVariants.find((v) => v.productId === pid);
          return {
            productId: pid,
            variantId: firstVar?.id || '',
            quantity: 5,
          };
        })
      );
    }
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    const linesPayload = lineDrafts.map((ld) => {
      const prod = dbState.products.find((p) => p.id === ld.productId) || dbState.products[0];
      const variant = ld.variantId
        ? dbState.productVariants.find((v) => v.id === ld.variantId)
        : null;
      const unitPricePaise = prod ? calculateVariantUnitPricePaise(prod, variant) : 0;
      return {
        productId: prod.id,
        variantId: variant?.id,
        quantity: Math.max(1, ld.quantity),
        unitPricePaise,
      };
    });

    if (showBuilderModal === 'QUOTATION') {
      const res = await apiRequest('/api/quotations', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          planId,
          validityDays: Number(validityDays || 15),
          taxRuleId,
          discountCode: discountCode.trim() || undefined,
          lines: linesPayload,
          status: 'QUOTATION',
        }),
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to create quotation.');
        return;
      }
      toast.success('Quotation created and calculated on server.');
    } else {
      const res = await apiRequest('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          planId,
          taxRuleId,
          discountCode: discountCode.trim() || undefined,
          lines: linesPayload,
          status: 'ACTIVE',
        }),
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to create subscription.');
        return;
      }
      toast.success('Subscription created and activated.');
    }

    setShowBuilderModal(null);
    await refreshState();
  };

  const handleConvertQuotation = async (quo: Quotation) => {
    const res = await apiRequest<{ subscription: Subscription }>(
      `/api/quotations/${quo.id}/convert`,
      {
        method: 'POST',
      }
    );
    if (!res.ok || !res.data) {
      toast.error(res.error || 'Could not convert quotation.');
      return;
    }
    toast.success(
      `Converted ${quo.quotationNumber} into Subscription ${res.data.subscription.subscriptionNumber}!`
    );
    await refreshState();
    setActiveTab('SUBSCRIPTIONS');
  };

  const handleUpdateQuotationStatus = async (quo: Quotation, status: Quotation['status']) => {
    const res = await apiRequest(`/api/quotations/${quo.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Failed to update status.');
      return;
    }
    toast.success(`${quo.quotationNumber} marked as ${status}.`);
    await refreshState();
  };

  const handleSubscriptionLifecycle = async (
    sub: Subscription,
    payload: { action?: string; targetStatus?: SubscriptionStatus }
  ) => {
    const res = await apiRequest(`/api/subscriptions/${sub.id}/lifecycle`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      toast.error(res.error || 'Lifecycle transition rejected.');
      return;
    }
    toast.success(
      payload.action === 'RENEW'
        ? `Renewed ${sub.subscriptionNumber}!`
        : `Updated ${sub.subscriptionNumber} to ${payload.targetStatus}.`
    );
    await refreshState();
  };

  const handleGenerateSingleInvoice = async (sub: Subscription) => {
    const res = await apiRequest<{ invoice: { invoiceNumber: string } }>(
      `/api/subscriptions/${sub.id}/generate-invoice`,
      {
        method: 'POST',
        body: JSON.stringify({ billingDate: sub.nextBillingDate || '2026-10-31' }),
      }
    );
    if (!res.ok) {
      toast.error(res.error || 'Could not generate invoice.');
      return;
    }
    toast.success(`Generated invoice ${res.data?.invoice.invoiceNumber} for ${sub.subscriptionNumber}!`);
    await refreshState();
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplName.trim()) return;
    const res = await apiRequest('/api/quotation-templates', {
      method: 'POST',
      body: JSON.stringify({
        name: tplName.trim(),
        planId: tplPlanId,
        validityDays: Number(tplValidity || 15),
        description: tplDesc,
        defaultProductIds: ['prod_101'],
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not save template.');
      return;
    }
    toast.success(`Saved quotation template "${tplName}".`);
    setShowTemplateModal(false);
    setTplName('');
    await refreshState();
  };

  return (
    <div className="space-y-6">
      {/* Header & Section Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Quotations & Subscription Lifecycle Management
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Full lifecycle enforcement: Draft → Quotation → Confirmed → Active → Paused → Closed
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('SUBSCRIPTIONS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'SUBSCRIPTIONS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Subscriptions ({dbState.subscriptions.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('QUOTATIONS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'QUOTATIONS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Quotations & Templates ({dbState.quotations.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowBuilderModal('QUOTATION')}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
            <span>New Quotation</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBuilderModal('SUBSCRIPTION')}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Subscription</span>
          </button>
        </div>
      </div>

      {activeTab === 'SUBSCRIPTIONS' && (
        <div className="space-y-4">
          {/* Search & Status Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search subscriptions"
                value={subSearch}
                onChange={(e) => {
                  setSubSearch(e.target.value);
                  setSubPage(1);
                }}
                placeholder="Search by subscription #, customer, or plan..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 overflow-x-auto">
              {['ALL', 'ACTIVE', 'PAUSED', 'CONFIRMED', 'QUOTATION', 'DRAFT', 'CLOSED'].map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setSubStatusFilter(st);
                      setSubPage(1);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      subStatusFilter === st
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Subscription #</th>
                    <th className="py-3 px-4">Customer · Plan</th>
                    <th className="py-3 px-4">Billing Schedule</th>
                    <th className="py-3 px-4 text-right">Subtotal · Tax · Discount</th>
                    <th className="py-3 px-4 text-right">Total Amount</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Lifecycle & Billing Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {paginatedSubscriptions.map((sub) => {
                    const lines = dbState.subscriptionLines.filter(
                      (l) => l.subscriptionId === sub.id
                    );
                    return (
                      <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-slate-900">
                            {sub.subscriptionNumber}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {sub.paymentTerms || 'Net 15 Days'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{sub.customerName}</div>
                          <div className="text-[11px] text-slate-500">
                            {sub.planName} ({sub.billingFrequency})
                          </div>
                          {lines.length > 0 && (
                            <div className="text-[11px] text-indigo-700 mt-0.5">
                              {lines
                                .map(
                                  (l) =>
                                    `${l.productName}${l.variantLabel ? ` [${l.variantLabel}]` : ''} ×${l.quantity}`
                                )
                                .join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-[11px] text-slate-600">
                          <div>Start: {formatIndianDate(sub.startDate)}</div>
                          <div>Next Bill: {formatIndianDate(sub.nextBillingDate)}</div>
                          <div>Expiry: {formatIndianDate(sub.expiryDate)}</div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[11px] text-slate-600">
                          <div>Sub: {formatINR(sub.subtotalPaise, true)}</div>
                          {sub.discountPaise > 0 && (
                            <div className="text-emerald-700">
                              Disc: -{formatINR(sub.discountPaise, true)}
                            </div>
                          )}
                          <div>Tax: +{formatINR(sub.taxPaise, true)}</div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                          {formatINR(sub.totalPaise, true)}
                        </td>
                        <td className="py-3.5 px-4 font-semibold">
                          <span
                            className={
                              sub.status === 'ACTIVE'
                                ? 'text-emerald-700'
                                : sub.status === 'PAUSED'
                                ? 'text-amber-700'
                                : sub.status === 'CLOSED'
                                ? 'text-red-700'
                                : 'text-indigo-700'
                            }
                          >
                            {sub.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {sub.status !== 'ACTIVE' && sub.status !== 'CLOSED' && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleSubscriptionLifecycle(sub, { targetStatus: 'ACTIVE' })
                                }
                                className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded inline-flex items-center gap-1"
                              >
                                <Play className="w-3 h-3" />
                                <span>{sub.status === 'PAUSED' ? 'Resume' : 'Activate'}</span>
                              </button>
                            )}

                            {sub.status === 'ACTIVE' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleGenerateSingleInvoice(sub)}
                                  className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded inline-flex items-center gap-1"
                                >
                                  <FileText className="w-3 h-3" />
                                  <span>Generate Invoice</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSubscriptionLifecycle(sub, { targetStatus: 'PAUSED' })
                                  }
                                  className="px-2.5 py-1 text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded inline-flex items-center gap-1"
                                >
                                  <Pause className="w-3 h-3" />
                                  <span>Pause</span>
                                </button>
                              </>
                            )}

                            {sub.status !== 'CLOSED' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSubscriptionLifecycle(sub, { action: 'RENEW' })
                                  }
                                  className="px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 border border-slate-300 rounded inline-flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Renew</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSubscriptionLifecycle(sub, { targetStatus: 'CLOSED' })
                                  }
                                  className="px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded inline-flex items-center gap-1"
                                >
                                  <XCircle className="w-3 h-3" />
                                  <span>Close</span>
                                </button>
                              </>
                            )}

                            <button
                              type="button"
                              aria-label={`Audit history for ${sub.subscriptionNumber}`}
                              onClick={() => setHistorySub(sub)}
                              className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                              title="View Audit History"
                            >
                              <History className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing {paginatedSubscriptions.length} of {filteredSubscriptions.length}{' '}
                subscriptions
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={subPage <= 1}
                  onClick={() => setSubPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-mono">Page {subPage}</span>
                <button
                  type="button"
                  disabled={subPage * pageSize >= filteredSubscriptions.length}
                  onClick={() => setSubPage((p) => p + 1)}
                  className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'QUOTATIONS' && (
        <div className="space-y-6">
          {/* Quotation Templates Row */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Reusable Quotation Templates</h2>
                <p className="text-xs text-slate-500">
                  Predefined product and plan blueprints with standard validity periods
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplateModal(true)}
                className="px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded-lg"
              >
                + New Template
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dbState.quotationTemplates.map((tpl) => {
                const plan = dbState.plans.find((p) => p.id === tpl.planId);
                return (
                  <div
                    key={tpl.id}
                    className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{tpl.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Plan: {plan?.name || tpl.planId} · Validity: {tpl.validityDays} Days
                      </div>
                      {tpl.description && (
                        <div className="text-[11px] text-slate-500 mt-0.5">{tpl.description}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        applyQuotationTemplate(tpl.id);
                        setShowBuilderModal('QUOTATION');
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-white hover:bg-indigo-50 text-indigo-700 border border-slate-300 rounded-md whitespace-nowrap shrink-0"
                    >
                      Use Template
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quotations List */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search quotations"
                value={quoSearch}
                onChange={(e) => setQuoSearch(e.target.value)}
                placeholder="Search quotations by number or customer..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <select
              aria-label="Filter quotation status"
              value={quoStatusFilter}
              onChange={(e) => setQuoStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">DRAFT</option>
              <option value="QUOTATION">QUOTATION</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="ACTIVE">ACTIVE (Converted)</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Quotation #</th>
                    <th className="py-3 px-4">Customer · Plan</th>
                    <th className="py-3 px-4">Valid Until</th>
                    <th className="py-3 px-4 text-right">Subtotal · Tax · Disc</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Conversion & Workflow</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredQuotations.map((quo) => (
                    <tr key={quo.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {quo.quotationNumber}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{quo.customerName}</div>
                        <div className="text-[11px] text-slate-500">{quo.planName}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600">
                        {formatIndianDate(quo.validUntil)} ({quo.validityDays || 15}d)
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[11px] text-slate-600">
                        <div>Sub: {formatINR(quo.subtotalPaise, true)}</div>
                        {quo.discountPaise > 0 && (
                          <div className="text-emerald-700">
                            Disc: -{formatINR(quo.discountPaise, true)}
                          </div>
                        )}
                        <div>Tax: +{formatINR(quo.taxPaise, true)}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatINR(quo.totalPaise, true)}
                      </td>
                      <td className="py-3.5 px-4 font-semibold">
                        <span
                          className={
                            quo.status === 'ACTIVE'
                              ? 'text-emerald-700'
                              : quo.status === 'CONFIRMED'
                              ? 'text-indigo-700'
                              : 'text-slate-600'
                          }
                        >
                          {quo.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          {quo.status === 'DRAFT' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateQuotationStatus(quo, 'QUOTATION')}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded"
                            >
                              Send Quotation
                            </button>
                          )}
                          {quo.status === 'QUOTATION' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateQuotationStatus(quo, 'CONFIRMED')}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Confirm</span>
                            </button>
                          )}
                          {quo.status !== 'ACTIVE' && quo.status !== 'CLOSED' && (
                            <button
                              type="button"
                              onClick={() => handleConvertQuotation(quo)}
                              className="px-3 py-1.5 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <span>Convert to Subscription</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                          {quo.convertedSubscriptionId && (
                            <span className="text-[11px] font-mono text-emerald-700">
                              Converted ✓
                            </span>
                          )}
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

      {/* Quotation / Subscription Builder Modal */}
      {showBuilderModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {showBuilderModal === 'QUOTATION'
                  ? 'Create Customer Quotation'
                  : 'Create Recurring Subscription'}
              </h2>
              <button
                type="button"
                onClick={() => setShowBuilderModal(null)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close ✕
              </button>
            </div>

            <form onSubmit={handleCreateDocument} className="space-y-4">
              {showBuilderModal === 'QUOTATION' && (
                <div>
                  <label htmlFor="b-tpl" className="block text-xs font-medium text-slate-700 mb-1">
                    Load Quotation Template (Optional)
                  </label>
                  <select
                    id="b-tpl"
                    value={selectedTemplateId}
                    onChange={(e) => applyQuotationTemplate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50"
                  >
                    <option value="">-- Custom Quotation --</option>
                    {dbState.quotationTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.validityDays} days validity)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="b-cust" className="block text-xs font-medium text-slate-700 mb-1">
                    Customer *
                  </label>
                  <select
                    id="b-cust"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    {dbState.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.company || c.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="b-plan" className="block text-xs font-medium text-slate-700 mb-1">
                    Subscription Plan *
                  </label>
                  <select
                    id="b-plan"
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    {dbState.plans
                      .filter((p) => p.status === 'ACTIVE')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.billingFrequency})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="b-val" className="block text-xs font-medium text-slate-700 mb-1">
                    Validity (Days)
                  </label>
                  <input
                    id="b-val"
                    type="number"
                    min="1"
                    value={validityDays}
                    onChange={(e) => setValidityDays(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Multi-Line Product & Variant Builder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    Product Lines & Variant Selection
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLineDrafts((prev) => [
                        ...prev,
                        {
                          productId: dbState.products[0]?.id || 'prod_101',
                          variantId: '',
                          quantity: 1,
                        },
                      ])
                    }
                    className="text-xs font-semibold text-indigo-600 hover:underline"
                  >
                    + Add Product Line
                  </button>
                </div>

                {lineDrafts.map((ld, idx) => {
                  const prod =
                    dbState.products.find((p) => p.id === ld.productId) || dbState.products[0];
                  const variants = dbState.productVariants.filter((v) => v.productId === prod?.id);
                  const chosenVar = variants.find((v) => v.id === ld.variantId) || null;
                  const unitPricePaise = prod
                    ? calculateVariantUnitPricePaise(prod, chosenVar)
                    : 0;

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                    >
                      <div className="col-span-4">
                        <select
                          aria-label={`Line ${idx + 1} product`}
                          value={ld.productId}
                          onChange={(e) => {
                            const nextPid = e.target.value;
                            const firstV = dbState.productVariants.find(
                              (v) => v.productId === nextPid
                            );
                            setLineDrafts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, productId: nextPid, variantId: firstV?.id || '' }
                                  : item
                              )
                            );
                          }}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                        >
                          {dbState.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({formatINR(p.salesPricePaise)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-4">
                        <select
                          aria-label={`Line ${idx + 1} variant`}
                          value={ld.variantId}
                          onChange={(e) =>
                            setLineDrafts((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, variantId: e.target.value } : item
                              )
                            )
                          }
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                        >
                          <option value="">Base Variant (+₹0)</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.attributeName}: {v.attributeValue} (+
                              {formatINR(v.additionalPricePaise)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          aria-label={`Line ${idx + 1} quantity`}
                          min="1"
                          value={ld.quantity}
                          onChange={(e) =>
                            setLineDrafts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, quantity: Math.max(1, Number(e.target.value || 1)) }
                                  : item
                              )
                            )
                          }
                          className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                        />
                      </div>

                      <div className="col-span-2 text-right font-mono text-xs font-semibold text-slate-900">
                        {formatINR(unitPricePaise * ld.quantity)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="b-tax" className="block text-xs font-medium text-slate-700 mb-1">
                    Tax Rule
                  </label>
                  <select
                    id="b-tax"
                    value={taxRuleId}
                    onChange={(e) => setTaxRuleId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="">No Tax (0%)</option>
                    {dbState.taxRules
                      .filter((t) => t.status === 'ACTIVE')
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({(t.percentageBasisPoints / 100).toFixed(1)}%)
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="b-disc" className="block text-xs font-medium text-slate-700 mb-1">
                    Discount Code (e.g. WELCOME10, ANNUAL5000)
                  </label>
                  <input
                    id="b-disc"
                    type="text"
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    placeholder="WELCOME10"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg uppercase"
                  />
                </div>
              </div>

              {/* Authoritative Totals Summary */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono tabular-nums">
                    {formatINR(liveCalculation.subtotalPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>
                    Discount{' '}
                    {liveCalculation.discountApplied
                      ? `(${discountCode.toUpperCase()})`
                      : liveCalculation.discountReason
                      ? `(${liveCalculation.discountReason})`
                      : ''}
                    :
                  </span>
                  <span className="font-mono tabular-nums">
                    -{formatINR(liveCalculation.discountPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Applicable Tax:</span>
                  <span className="font-mono tabular-nums">
                    +{formatINR(liveCalculation.taxPaise, true)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span className="font-mono tabular-nums text-indigo-700">
                    {formatINR(liveCalculation.totalPaise, true)}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBuilderModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  {showBuilderModal === 'QUOTATION'
                    ? 'Save Quotation'
                    : 'Create & Activate Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Quotation Template Modal */}
      {showTemplateModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Create Quotation Template</h3>
            <form onSubmit={handleSaveTemplate} className="space-y-3">
              <div>
                <label htmlFor="tpl-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Template Name *
                </label>
                <input
                  id="tpl-name"
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="Standard 10-Seat SaaS Rollout"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="tpl-plan" className="block text-xs font-medium text-slate-700 mb-1">
                  Default Plan
                </label>
                <select
                  id="tpl-plan"
                  value={tplPlanId}
                  onChange={(e) => setTplPlanId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {dbState.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tpl-val" className="block text-xs font-medium text-slate-700 mb-1">
                  Validity Days
                </label>
                <input
                  id="tpl-val"
                  type="number"
                  min="1"
                  value={tplValidity}
                  onChange={(e) => setTplValidity(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="tpl-desc" className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <input
                  id="tpl-desc"
                  type="text"
                  value={tplDesc}
                  onChange={(e) => setTplDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subscription Audit History Modal */}
      {historySub && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Audit History · {historySub.subscriptionNumber}
              </h3>
              <button
                type="button"
                onClick={() => setHistorySub(null)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Close ✕
              </button>
            </div>
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {dbState.auditLogs
                .filter((a) => a.entityId === historySub.id)
                .map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold text-slate-900">
                      <span>{log.action}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatIndianDate(log.createdAt)}
                      </span>
                    </div>
                    <p className="text-slate-600 mt-1">{log.details}</p>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Actor: {log.actorName} ({log.actorRole})
                    </div>
                  </div>
                ))}
              {dbState.auditLogs.filter((a) => a.entityId === historySub.id).length === 0 && (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Initial contract created on {formatIndianDate(historySub.createdAt)}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
