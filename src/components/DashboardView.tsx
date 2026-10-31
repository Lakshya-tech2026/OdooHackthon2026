import React, { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Calendar,
  ArrowUpRight,
  RefreshCw,
  FileText,
  CreditCard,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  calculateRecurringMetrics,
  formatINR,
  formatIndianDate,
} from '../lib/billingEngine';

type DateRangePreset = 'TODAY' | '7D' | '30D' | '90D' | 'ALL' | 'CUSTOM';

export const DashboardView: React.FC<{
  onNavigate: (view: string) => void;
}> = ({ onNavigate }) => {
  const { dbState, apiRequest, refreshState, currentUser } = useApp();

  const [rangePreset, setRangePreset] = useState<DateRangePreset>('ALL');
  const [customFrom, setCustomFrom] = useState('2026-01-01');
  const [customTo, setCustomTo] = useState('2026-12-31');
  const [runningBatch, setRunningBatch] = useState(false);

  // Reference current date from environment metadata (2026-10-31)
  const referenceToday = '2026-10-31';

  const dateFilterBounds = useMemo(() => {
    const end = referenceToday;
    const endObj = new Date(end + 'T23:59:59Z');
    if (rangePreset === 'TODAY') {
      return { from: end, to: end };
    }
    if (rangePreset === '7D') {
      const d = new Date(endObj);
      d.setUTCDate(d.getUTCDate() - 7);
      return { from: d.toISOString().slice(0, 10), to: end };
    }
    if (rangePreset === '30D') {
      const d = new Date(endObj);
      d.setUTCDate(d.getUTCDate() - 30);
      return { from: d.toISOString().slice(0, 10), to: end };
    }
    if (rangePreset === '90D') {
      const d = new Date(endObj);
      d.setUTCDate(d.getUTCDate() - 90);
      return { from: d.toISOString().slice(0, 10), to: end };
    }
    if (rangePreset === 'CUSTOM') {
      return { from: customFrom || '2020-01-01', to: customTo || '2030-12-31' };
    }
    return { from: '2020-01-01', to: '2030-12-31' };
  }, [rangePreset, customFrom, customTo]);

  const filteredPayments = useMemo(() => {
    return dbState.payments.filter((p) => {
      const d = p.paymentDate.slice(0, 10);
      return d >= dateFilterBounds.from && d <= dateFilterBounds.to;
    });
  }, [dbState.payments, dateFilterBounds]);

  const filteredInvoices = useMemo(() => {
    return dbState.invoices.filter((inv) => {
      const d = inv.invoiceDate.slice(0, 10);
      return d >= dateFilterBounds.from && d <= dateFilterBounds.to;
    });
  }, [dbState.invoices, dateFilterBounds]);

  const kpis = useMemo(() => {
    const totalCustomers = dbState.customers.length;
    const totalProducts = dbState.products.filter((p) => p.status === 'ACTIVE').length;
    const recurring = calculateRecurringMetrics(dbState.subscriptions);

    const totalRevenuePaise = filteredPayments.reduce((sum, p) => sum + p.amountPaise, 0);
    const outstandingPaise = filteredInvoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);
    const overdueInvoices = dbState.invoices.filter(
      (inv) => inv.balanceDuePaise > 0 && (inv.paymentStatus === 'OVERDUE' || inv.dueDate < referenceToday)
    );
    const overduePaise = overdueInvoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);

    return {
      totalCustomers,
      activeSubscriptions: recurring.activeCount,
      totalProducts,
      totalRevenuePaise,
      outstandingPaise,
      overdueCount: overdueInvoices.length,
      overduePaise,
      mrrPaise: recurring.mrrPaise,
      arrPaise: recurring.arrPaise,
      overdueInvoices,
    };
  }, [dbState, filteredPayments, filteredInvoices]);

  // Build real database-driven chart series
  const revenueChartData = useMemo(() => {
    const months = [
      { key: '2026-06', label: 'Jun 2026' },
      { key: '2026-07', label: 'Jul 2026' },
      { key: '2026-08', label: 'Aug 2026' },
      { key: '2026-09', label: 'Sep 2026' },
      { key: '2026-10', label: 'Oct 2026' },
    ];
    return months.map((m) => {
      const billedPaise = dbState.invoices
        .filter((i) => i.invoiceDate.startsWith(m.key))
        .reduce((acc, i) => acc + i.grandTotalPaise, 0);
      const collectedPaise = dbState.payments
        .filter((p) => p.paymentDate.startsWith(m.key))
        .reduce((acc, p) => acc + p.amountPaise, 0);
      const activeSubsUpToMonth = dbState.subscriptions.filter(
        (s) => s.startDate.slice(0, 7) <= m.key && s.status !== 'CLOSED'
      ).length;

      return {
        month: m.label,
        billedRupees: Math.round(billedPaise / 100),
        collectedRupees: Math.round(collectedPaise / 100),
        subscriptions: activeSubsUpToMonth,
      };
    });
  }, [dbState.invoices, dbState.payments, dbState.subscriptions]);

  const upcomingRenewals = useMemo(() => {
    return [...dbState.subscriptions]
      .filter((s) => s.status === 'ACTIVE')
      .sort((a, b) => (a.nextBillingDate || a.expiryDate).localeCompare(b.nextBillingDate || b.expiryDate))
      .slice(0, 5);
  }, [dbState.subscriptions]);

  const handleRunDueBilling = async () => {
    setRunningBatch(true);
    const res = await apiRequest<{
      generatedCount: number;
      skippedDuplicateCount: number;
    }>('/api/invoices/generate-batch', {
      method: 'POST',
      body: JSON.stringify({ billingDate: referenceToday }),
    });
    setRunningBatch(false);
    if (res.ok && res.data) {
      await refreshState();
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar & Date Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 pb-4 border-b border-[#e0e2d6]">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#18251d]">
            Executive Revenue & Subscription Overview
          </h1>
          <p className="text-xs text-[#465247] mt-0.5">
            Live database metrics calculated in minor currency units (₹ / Paise) · Signed in as{' '}
            <span className="font-medium text-[#18251d]">{currentUser?.name}</span> (
            {currentUser?.role})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Interactive Date Filter Controls */}
          <div
            role="group"
            aria-label="Date range filter"
            className="flex flex-wrap items-center gap-1 p-1 bg-[#eceee4] rounded-lg border border-[#dfe1d5] max-w-full"
          >
            {(
              [
                { id: 'TODAY', label: 'Today' },
                { id: '7D', label: '7 Days' },
                { id: '30D', label: '30 Days' },
                { id: '90D', label: '90 Days' },
                { id: 'ALL', label: 'All Time' },
                { id: 'CUSTOM', label: 'Custom Range' },
              ] as { id: DateRangePreset; label: string }[]
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setRangePreset(btn.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  rangePreset === btn.id
                    ? 'bg-white text-[#18251d] font-semibold shadow-xs'
                    : 'text-[#3f4a40] hover:text-[#18251d]'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleRunDueBilling}
            disabled={runningBatch}
            className="px-3.5 py-1.5 bg-[#d5f36a] hover:bg-[#c5e753] text-[#18251d] border border-[#c2e254] text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningBatch ? 'animate-spin' : ''}`} />
            <span>{runningBatch ? 'Running Batch Billing...' : 'Generate Due Invoices'}</span>
          </button>
        </div>
      </div>

      {rangePreset === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-4 p-3.5 bg-white rounded-xl border border-[#e0e2d6]">
          <div className="flex items-center gap-2 text-xs font-medium text-[#18251d]">
            <Calendar className="w-4 h-4 text-[#244a36]" />
            <span>Custom Period Filter:</span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="dash-from" className="text-xs text-[#465247]">
              From
            </label>
            <input
              id="dash-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2.5 py-1 text-xs font-mono border border-[#cfd2c5] rounded-lg"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="dash-to" className="text-xs text-[#465247]">
              To
            </label>
            <input
              id="dash-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2.5 py-1 text-xs font-mono border border-[#cfd2c5] rounded-lg"
            />
          </div>
        </div>
      )}

      {/* Compact 4-Column KPI Metric Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span className="truncate">Monthly Recurring Revenue</span>
            <span className="font-mono text-[#244a36] font-medium shrink-0">MRR</span>
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#18251d]">
            {formatINR(kpis.mrrPaise)}
          </div>
          <div className="mt-1 text-xs text-[#465247]">
            Normalized across {kpis.activeSubscriptions} active contracts
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span className="truncate">Annual Recurring Revenue</span>
            <span className="font-mono text-[#244a36] font-medium shrink-0">12× MRR</span>
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#18251d]">
            {formatINR(kpis.arrPaise)}
          </div>
          <div className="mt-1 text-xs text-[#465247]">
            Annualized run-rate from live subscriptions
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span className="truncate">Collected Revenue</span>
            <span className="font-mono text-[#244a36] shrink-0">{filteredPayments.length} paid</span>
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#244a36]">
            {formatINR(kpis.totalRevenuePaise)}
          </div>
          <div className="mt-1 text-xs text-[#465247]">
            Settled payments in selected period
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span className="truncate">Outstanding & Overdue</span>
            <span className="text-red-700 font-medium shrink-0">{kpis.overdueCount} overdue</span>
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#18251d]">
            {formatINR(kpis.outstandingPaise)}
          </div>
          <div className="mt-1 text-xs text-red-700 font-mono tabular-nums">
            {formatINR(kpis.overduePaise)} past due date
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span>Total Customers</span>
            <button
              type="button"
              onClick={() => onNavigate('customers')}
              className="text-[#244a36] hover:underline font-medium inline-flex items-center gap-0.5"
            >
              <span>Directory</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-[#18251d]">
            {kpis.totalCustomers}{' '}
            <span className="text-xs font-sans font-normal text-[#465247]">
              · Active GST & B2B accounts
            </span>
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span>Active Subscriptions</span>
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="text-[#244a36] hover:underline font-medium inline-flex items-center gap-0.5"
            >
              <span>Manage</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-[#18251d]">
            {kpis.activeSubscriptions}{' '}
            <span className="text-xs font-sans font-normal text-[#465247]">
              / {dbState.subscriptions.length} recurring contracts
            </span>
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span>Catalog Products & Variants</span>
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="text-[#244a36] hover:underline font-medium inline-flex items-center gap-0.5"
            >
              <span>Catalog</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-[#18251d]">
            {kpis.totalProducts}{' '}
            <span className="text-xs font-sans font-normal text-[#465247]">
              · {dbState.productVariants.length} variants (Odoo & SaaS)
            </span>
          </div>
        </div>

        <div className="bg-white border border-[#e0e2d6] rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs text-[#465247]">
            <span>Active Plans & Tax Rules</span>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="text-[#244a36] hover:underline font-medium inline-flex items-center gap-0.5"
            >
              <span>Billing</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-[#18251d]">
            {dbState.plans.filter((p) => p.status === 'ACTIVE').length} plans{' '}
            <span className="text-xs font-sans font-normal text-[#465247]">
              · {dbState.taxRules.filter((t) => t.status === 'ACTIVE').length} tax rules
            </span>
          </div>
        </div>
      </div>

      {/* Charts Row (Forest Green & Lime Green Palette) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-white border border-[#e0e2d6] rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-[#18251d]">
                Revenue Overview (Billed vs. Collected ₹)
              </h2>
              <p className="text-xs text-[#465247]">
                Monthly invoiced grand totals compared against recorded customer payments
              </p>
            </div>
            <div className="text-xs text-[#244a36] font-mono">Currency: INR (₹)</div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueChartData} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6dc" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#465247' }} />
                <YAxis
                  tick={{ fontSize: 12, fill: '#465247' }}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Amount']}
                />
                <Area
                  type="monotone"
                  dataKey="billedRupees"
                  name="Billed Invoices (₹)"
                  stroke="#244a36"
                  fill="#244a36"
                  fillOpacity={0.14}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="collectedRupees"
                  name="Payments Received (₹)"
                  stroke="#7ba614"
                  fill="#d5f36a"
                  fillOpacity={0.35}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-[#e0e2d6] rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-[#18251d]">Subscription Growth</h2>
              <p className="text-xs text-[#465247]">
                Cumulative active customer subscriptions across billing cycles
              </p>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChartData} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6dc" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#465247' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#465247' }} />
                <Tooltip />
                <Bar
                  dataKey="subscriptions"
                  name="Active Subscriptions"
                  fill="#244a36"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Operational Tables Row 1: Recent Subscriptions & Upcoming Renewals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#e0e2d6] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#e0e2d6] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#18251d]">Recent Subscriptions</h2>
              <p className="text-xs text-[#465247]">Latest recurring contracts and status</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="text-xs font-semibold text-[#244a36] hover:underline inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>View All</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e0e2d6] bg-[#f6f5ef] text-xs font-semibold text-[#384439]">
                  <th className="py-2.5 px-4">Subscription #</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Frequency</th>
                  <th className="py-2.5 px-4 text-right">Total</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e9df] text-xs">
                {dbState.subscriptions.slice(0, 5).map((sub) => (
                  <tr key={sub.id} className="hover:bg-[#fafaf5] transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-[#18251d]">
                      {sub.subscriptionNumber}
                    </td>
                    <td className="py-2.5 px-4 text-[#2c382e]">{sub.customerName}</td>
                    <td className="py-2.5 px-4 text-[#465247]">{sub.billingFrequency}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-[#18251d]">
                      {formatINR(sub.totalPaise, true)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">
                      <span
                        className={
                          sub.status === 'ACTIVE'
                            ? 'text-[#1b5e3a]'
                            : sub.status === 'PAUSED'
                            ? 'text-[#9a5b13]'
                            : 'text-[#465247]'
                        }
                      >
                        {sub.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Upcoming Renewals */}
        <div className="bg-white border border-[#e0e2d6] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#e0e2d6] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#18251d]">Upcoming Renewals & Next Billing</h2>
              <p className="text-xs text-[#465247]">
                Active contracts scheduled for automated invoice generation
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunDueBilling}
              className="px-2.5 py-1 rounded-md bg-[#d5f36a] hover:bg-[#c5e753] text-[#18251d] text-xs font-semibold"
            >
              Run Batch Now
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e0e2d6] bg-[#f6f5ef] text-xs font-semibold text-[#384439]">
                  <th className="py-2.5 px-4">Contract</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Next Billing</th>
                  <th className="py-2.5 px-4">Expiry Date</th>
                  <th className="py-2.5 px-4 text-right">Cycle Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e9df] text-xs">
                {upcomingRenewals.map((sub) => (
                  <tr key={sub.id} className="hover:bg-[#fafaf5] transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-[#18251d]">
                      {sub.subscriptionNumber}
                    </td>
                    <td className="py-2.5 px-4 text-[#2c382e]">{sub.customerName}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[#244a36] font-medium">
                      {formatIndianDate(sub.nextBillingDate || sub.startDate)}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[#465247]">
                      {formatIndianDate(sub.expiryDate)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-[#18251d]">
                      {formatINR(sub.totalPaise, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Operational Tables Row 2: Overdue Invoices & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Overdue Invoices List */}
        <div className="bg-white border border-[#e0e2d6] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#e0e2d6] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-700" />
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">Overdue Invoices</h2>
                <p className="text-xs text-[#465247]">
                  Invoices with unpaid balances past their due date
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="text-xs font-semibold text-[#244a36] hover:underline inline-flex items-center gap-1"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Collect Payments</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e0e2d6] bg-[#f6f5ef] text-xs font-semibold text-[#384439]">
                  <th className="py-2.5 px-4">Invoice #</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Due Date</th>
                  <th className="py-2.5 px-4 text-right">Balance Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e9df] text-xs">
                {kpis.overdueInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[#465247]">
                      No overdue invoices. All due balances are settled.
                    </td>
                  </tr>
                ) : (
                  kpis.overdueInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-[#fafaf5] transition-colors">
                      <td className="py-2.5 px-4 font-mono font-medium text-[#18251d]">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-2.5 px-4 text-[#2c382e]">{inv.customerName}</td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-red-700">
                        {formatIndianDate(inv.dueDate)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-red-700">
                        {formatINR(inv.balanceDuePaise, true)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white border border-[#e0e2d6] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#e0e2d6] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#244a36]" />
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">Recent Payment Transactions</h2>
                <p className="text-xs text-[#465247]">
                  Verified UPI, Bank Transfer, Card, and Cash collections
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="text-xs font-semibold text-[#244a36] hover:underline"
            >
              Payment Ledger
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e0e2d6] bg-[#f6f5ef] text-xs font-semibold text-[#384439]">
                  <th className="py-2.5 px-4">Payment #</th>
                  <th className="py-2.5 px-4">Invoice</th>
                  <th className="py-2.5 px-4">Method · Date</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e9df] text-xs">
                {filteredPayments.slice(0, 5).map((pay) => (
                  <tr key={pay.id} className="hover:bg-[#fafaf5] transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-[#18251d]">
                      {pay.paymentNumber}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#2c382e]">{pay.invoiceNumber}</td>
                    <td className="py-2.5 px-4 text-[#2c382e]">
                      <span>{pay.paymentMethod}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">
                        {formatIndianDate(pay.paymentDate)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-[#1b5e3a]">
                      {formatINR(pay.amountPaise, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
