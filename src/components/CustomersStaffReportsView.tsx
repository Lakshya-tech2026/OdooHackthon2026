import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Plus,
  Search,
  Download,
  UserCheck,
  Shield,
  Printer,
  CreditCard,
  Play,
  Pause,
  RotateCcw,
  Save,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  calculateRecurringMetrics,
  formatINR,
  formatIndianDate,
  rupeesToPaise,
} from '../lib/billingEngine';
import { Invoice, Staff, Subscription, SubscriptionStatus } from '../types/domain';

// ============================================================================
// 1. CUSTOMERS, STAFF & AUDIT LOGS VIEW
// ============================================================================

export const CustomersStaffView: React.FC<{
  initialTab?: 'CUSTOMERS' | 'STAFF' | 'AUDIT';
}> = ({ initialTab = 'CUSTOMERS' }) => {
  const { dbState, currentUser, apiRequest, refreshState } = useApp();
  const isAdmin = currentUser?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'CUSTOMERS' | 'STAFF' | 'AUDIT'>(initialTab);
  const [custSearch, setCustSearch] = useState('');

  // Add Customer Modal
  const [showCustModal, setShowCustModal] = useState(false);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cCompany, setCCompany] = useState('');
  const [cGstin, setCGstin] = useState('');
  const [cAddress, setCAddress] = useState('');

  // Add Staff Modal (Admin Only)
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sDept, setSDept] = useState('Revenue Operations');
  const [sRole, setSRole] = useState<'STAFF' | 'ADMIN'>('STAFF');
  const [sPassword, setSPassword] = useState('Staff@2026!');

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    return dbState.customers.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.gstin || '').toLowerCase().includes(q)
      );
    });
  }, [dbState.customers, custSearch]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: cName,
        email: cEmail,
        phone: cPhone,
        company: cCompany,
        gstin: cGstin,
        billingAddress: cAddress,
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not add customer.');
      return;
    }
    toast.success(`Added customer "${cName}".`);
    setShowCustModal(false);
    setCName('');
    setCEmail('');
    await refreshState();
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/staff', {
      method: 'POST',
      body: JSON.stringify({
        name: sName,
        email: sEmail,
        department: sDept,
        role: sRole,
        password: sPassword,
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not create staff account.');
      return;
    }
    toast.success(`Created ${sRole} account for ${sName}!`);
    setShowStaffModal(false);
    setSName('');
    setSEmail('');
    await refreshState();
  };

  const handleToggleStaffStatus = async (stf: Staff) => {
    const nextStatus = stf.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await apiRequest(`/api/staff/${stf.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Failed to update staff status.');
      return;
    }
    toast.success(`Staff account ${stf.name} is now ${nextStatus}.`);
    await refreshState();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Customers, Staff Accounts & Audit Logs
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage B2B customer accounts, Admin-restricted staff permissions, and system activity
            history
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('CUSTOMERS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'CUSTOMERS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Customers ({dbState.customers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('STAFF')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'STAFF'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Staff Management ({dbState.staff.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('AUDIT')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'AUDIT'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Audit Logs ({dbState.auditLogs.length})
            </button>
          </div>

          {activeTab === 'CUSTOMERS' && (
            <button
              type="button"
              onClick={() => setShowCustModal(true)}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Customer</span>
            </button>
          )}

          {activeTab === 'STAFF' && isAdmin && (
            <button
              type="button"
              onClick={() => setShowStaffModal(true)}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
            >
              <Shield className="w-4 h-4" />
              <span>Create Staff Account</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'CUSTOMERS' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              aria-label="Search customers"
              value={custSearch}
              onChange={(e) => setCustSearch(e.target.value)}
              placeholder="Search customers by name, company, email, or GSTIN..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Customer · Company</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">GSTIN · Billing Address</th>
                    <th className="py-3 px-4 text-right">Active Contracts</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredCustomers.map((c) => {
                    const activeSubs = dbState.subscriptions.filter(
                      (s) => s.customerId === c.id && s.status === 'ACTIVE'
                    ).length;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {c.company || 'Individual Account'} ·{' '}
                            <span className="font-mono">{c.id}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-slate-800">{c.email}</div>
                          <div className="font-mono text-[11px] text-slate-500">{c.phone}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono text-indigo-700 font-medium">
                            {c.gstin || 'Unregistered GST'}
                          </div>
                          <div className="text-[11px] text-slate-500 max-w-xs truncate">
                            {c.billingAddress}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {activeSubs}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-emerald-700">{c.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'STAFF' && (
        <div className="space-y-4">
          {!isAdmin && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              Restricted View: Only Administrators can create staff accounts or modify role
              assignments.
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Staff Name · ID</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Permitted Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {dbState.staff.map((stf) => (
                    <tr key={stf.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{stf.name}</div>
                        <div className="text-[11px] font-mono text-slate-400">{stf.id}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{stf.email}</td>
                      <td className="py-3.5 px-4 text-slate-600">{stf.department}</td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-indigo-700">
                        {stf.role}
                      </td>
                      <td className="py-3.5 px-4 font-semibold">
                        <span
                          className={
                            stf.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'
                          }
                        >
                          {stf.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => handleToggleStaffStatus(stf)}
                            className="px-2.5 py-1 text-[11px] font-semibold border border-slate-300 rounded hover:bg-slate-100 text-slate-700"
                          >
                            {stf.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                        ) : (
                          <span className="text-slate-400">Admin Only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'AUDIT' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor · Role</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Audit Trail Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {dbState.auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatIndianDate(log.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900">{log.actorName}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono text-indigo-700">{log.actorRole}</span>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {log.entityType} ({log.entityId})
                    </td>
                    <td className="py-3 px-4 text-slate-700">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showCustModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Add New B2B Customer</h3>
            <form onSubmit={handleCreateCustomer} className="space-y-3">
              <div>
                <label htmlFor="nc-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Contact Name *
                </label>
                <input
                  id="nc-name"
                  type="text"
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="nc-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Email Address *
                </label>
                <input
                  id="nc-email"
                  type="email"
                  required
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nc-comp" className="block text-xs font-medium text-slate-700 mb-1">
                    Company
                  </label>
                  <input
                    id="nc-comp"
                    type="text"
                    value={cCompany}
                    onChange={(e) => setCCompany(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="nc-gst" className="block text-xs font-medium text-slate-700 mb-1">
                    GSTIN
                  </label>
                  <input
                    id="nc-gst"
                    type="text"
                    value={cGstin}
                    onChange={(e) => setCGstin(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="nc-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Phone
                </label>
                <input
                  id="nc-phone"
                  type="text"
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="nc-addr" className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Address
                </label>
                <input
                  id="nc-addr"
                  type="text"
                  value={cAddress}
                  onChange={(e) => setCAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Staff Modal */}
      {showStaffModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Create Staff Account (Admin Only)</h3>
            <form onSubmit={handleCreateStaff} className="space-y-3">
              <div>
                <label htmlFor="st-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name *
                </label>
                <input
                  id="st-name"
                  type="text"
                  required
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="st-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Work Email *
                </label>
                <input
                  id="st-email"
                  type="email"
                  required
                  value={sEmail}
                  onChange={(e) => setSEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="st-dept" className="block text-xs font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <input
                    id="st-dept"
                    type="text"
                    value={sDept}
                    onChange={(e) => setSDept(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="st-role" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Role
                  </label>
                  <select
                    id="st-role"
                    value={sRole}
                    onChange={(e) => setSRole(e.target.value as 'STAFF' | 'ADMIN')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="STAFF">STAFF</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="st-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Initial Password (&gt;8 chars, upper, lower, special) *
                </label>
                <input
                  id="st-pw"
                  type="password"
                  required
                  value={sPassword}
                  onChange={(e) => setSPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Create Staff Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. REPORTS & ANALYTICS VIEW (WITH MULTI-FILTER & CSV EXPORT)
// ============================================================================

export const ReportsAnalyticsView: React.FC = () => {
  const { dbState } = useApp();

  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [productFilter, setProductFilter] = useState('ALL');
  const [subStatusFilter, setSubStatusFilter] = useState('ALL');
  const [invStatusFilter, setInvStatusFilter] = useState('ALL');
  const [payMethodFilter, setPayMethodFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState('2027-12-31');

  const analytics = useMemo(() => {
    const subs = dbState.subscriptions.filter((s) => {
      if (customerFilter !== 'ALL' && s.customerId !== customerFilter) return false;
      if (subStatusFilter !== 'ALL' && s.status !== subStatusFilter) return false;
      return s.startDate >= dateFrom && s.startDate <= dateTo;
    });

    const invoices = dbState.invoices.filter((i) => {
      if (customerFilter !== 'ALL' && i.customerId !== customerFilter) return false;
      if (
        invStatusFilter !== 'ALL' &&
        i.status !== invStatusFilter &&
        i.paymentStatus !== invStatusFilter
      )
        return false;
      return i.invoiceDate >= dateFrom && i.invoiceDate <= dateTo;
    });

    const payments = dbState.payments.filter((p) => {
      if (customerFilter !== 'ALL' && p.customerId !== customerFilter) return false;
      if (payMethodFilter !== 'ALL' && p.paymentMethod !== payMethodFilter) return false;
      return p.paymentDate >= dateFrom && p.paymentDate <= dateTo;
    });

    const recurring = calculateRecurringMetrics(subs);

    // Product-wise revenue breakdown
    const productRevenueMap = new Map<
      string,
      { productId: string; productName: string; revenuePaise: number; unitsSold: number }
    >();

    for (const prod of dbState.products) {
      if (productFilter !== 'ALL' && prod.id !== productFilter) continue;
      productRevenueMap.set(prod.id, {
        productId: prod.id,
        productName: prod.name,
        revenuePaise: 0,
        unitsSold: 0,
      });
    }

    for (const line of dbState.invoiceLines) {
      if (productFilter !== 'ALL' && line.productId !== productFilter) continue;
      const existing = productRevenueMap.get(line.productId);
      if (existing) {
        existing.revenuePaise += line.lineTotalPaise;
        existing.unitsSold += line.quantity;
      }
    }

    const totalDiscountUsedCount = dbState.discountRules.reduce((s, d) => s + d.usedCount, 0);
    const totalDiscountAmountPaise = invoices.reduce((s, i) => s + i.discountPaise, 0);

    return {
      activeCount: subs.filter((s) => s.status === 'ACTIVE').length,
      newCount: subs.filter((s) => s.startDate >= '2026-08-01').length,
      closedCount: subs.filter((s) => s.status === 'CLOSED').length,
      totalBilledPaise: invoices.reduce((s, i) => s + i.grandTotalPaise, 0),
      paymentsReceivedPaise: payments.reduce((s, p) => s + p.amountPaise, 0),
      outstandingPaise: invoices.reduce((s, i) => s + i.balanceDuePaise, 0),
      overdueCount: invoices.filter(
        (i) => i.balanceDuePaise > 0 && (i.paymentStatus === 'OVERDUE' || i.dueDate < '2026-10-31')
      ).length,
      mrrPaise: recurring.mrrPaise,
      arrPaise: recurring.arrPaise,
      totalDiscountUsedCount,
      totalDiscountAmountPaise,
      productBreakdown: Array.from(productRevenueMap.values()),
    };
  }, [
    dbState,
    customerFilter,
    productFilter,
    subStatusFilter,
    invStatusFilter,
    payMethodFilter,
    dateFrom,
    dateTo,
  ]);

  const handleExportCsv = () => {
    const headers = [
      'Metric / Product',
      'Category',
      'Units / Count',
      'Amount (Paise)',
      'Formatted INR',
    ];
    const rows = [
      ['Active Subscriptions', 'Subscriptions', String(analytics.activeCount), '0', '-'],
      ['Monthly Recurring Revenue (MRR)', 'Recurring', '1', String(analytics.mrrPaise), formatINR(analytics.mrrPaise, true)],
      ['Annual Recurring Revenue (ARR)', 'Recurring', '12', String(analytics.arrPaise), formatINR(analytics.arrPaise, true)],
      ['Payments Received', 'Collections', '-', String(analytics.paymentsReceivedPaise), formatINR(analytics.paymentsReceivedPaise, true)],
      ['Outstanding Balance', 'Receivables', '-', String(analytics.outstandingPaise), formatINR(analytics.outstandingPaise, true)],
      ...analytics.productBreakdown.map((pb) => [
        pb.productName,
        'Product Revenue',
        String(pb.unitsSold),
        String(pb.revenuePaise),
        formatINR(pb.revenuePaise, true),
      ]),
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `brightloop_report_${dateFrom}_to_${dateTo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Exported operational report to CSV.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Financial Reports & Operational Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Filterable cohort metrics, product-wise revenue attribution, discount utilization, and
            CSV export
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Download CSV Report</span>
        </button>
      </div>

      {/* Multi-Dimension Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
        <div>
          <label htmlFor="rep-cust" className="block text-[11px] text-slate-500 mb-1">
            Customer
          </label>
          <select
            id="rep-cust"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50"
          >
            <option value="ALL">All Customers</option>
            {dbState.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-prod" className="block text-[11px] text-slate-500 mb-1">
            Product
          </label>
          <select
            id="rep-prod"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50"
          >
            <option value="ALL">All Products</option>
            {dbState.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-sub" className="block text-[11px] text-slate-500 mb-1">
            Subscription Status
          </label>
          <select
            id="rep-sub"
            value={subStatusFilter}
            onChange={(e) => setSubStatusFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAUSED">PAUSED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>

        <div>
          <label htmlFor="rep-inv" className="block text-[11px] text-slate-500 mb-1">
            Invoice Status
          </label>
          <select
            id="rep-inv"
            value={invStatusFilter}
            onChange={(e) => setInvStatusFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50"
          >
            <option value="ALL">All Invoices</option>
            <option value="PAID">PAID</option>
            <option value="PARTIAL">PARTIAL</option>
            <option value="OVERDUE">OVERDUE</option>
          </select>
        </div>

        <div>
          <label htmlFor="rep-pay" className="block text-[11px] text-slate-500 mb-1">
            Payment Method
          </label>
          <select
            id="rep-pay"
            value={payMethodFilter}
            onChange={(e) => setPayMethodFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50"
          >
            <option value="ALL">All Methods</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">BANK_TRANSFER</option>
            <option value="CARD">CARD</option>
            <option value="CASH">CASH</option>
          </select>
        </div>

        <div>
          <label htmlFor="rep-from" className="block text-[11px] text-slate-500 mb-1">
            From Date
          </label>
          <input
            id="rep-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-slate-50"
          />
        </div>
      </div>

      {/* Report Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Active · New · Closed Subscriptions</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900">
            {analytics.activeCount} Active · {analytics.newCount} New · {analytics.closedCount}{' '}
            Closed
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">MRR & ARR Run-Rate</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums text-indigo-700">
            {formatINR(analytics.mrrPaise)}{' '}
            <span className="text-xs font-normal text-slate-500">
              / {formatINR(analytics.arrPaise)} ARR
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Payments Received vs. Outstanding</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums text-emerald-700">
            {formatINR(analytics.paymentsReceivedPaise)}{' '}
            <span className="text-xs font-normal text-red-600">
              ({formatINR(analytics.outstandingPaise)} due)
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Discount Usage & Rebates</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900">
            {analytics.totalDiscountUsedCount} redemptions ·{' '}
            {formatINR(analytics.totalDiscountAmountPaise)}
          </div>
        </div>
      </div>

      {/* Product-wise Revenue Chart & Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Product-Wise Revenue (INR ₹)</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.productBreakdown.map((p) => ({
                  name: p.productName.slice(0, 22),
                  revenueRupees: Math.round(p.revenuePaise / 100),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Revenue']}
                />
                <Bar dataKey="revenueRupees" fill="#4f46e5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">
              Product-Wise Revenue Attribution Table
            </h2>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-4">Product Name</th>
                <th className="py-2.5 px-4 text-right">Invoiced Units</th>
                <th className="py-2.5 px-4 text-right">Billed Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {analytics.productBreakdown.map((pb) => (
                <tr key={pb.productId}>
                  <td className="py-3 px-4 font-medium text-slate-900">{pb.productName}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    {pb.unitsSold}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {formatINR(pb.revenuePaise, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. DEDICATED CUSTOMER PORTAL (ISOLATED SELF-SERVICE)
// ============================================================================

export const CustomerPortalView: React.FC = () => {
  const { dbState, currentUser, apiRequest, refreshState } = useApp();

  const myCustomer = useMemo(() => {
    return (
      dbState.customers.find(
        (c) =>
          c.id === currentUser?.customerId ||
          c.userId === currentUser?.id ||
          c.email.toLowerCase() === currentUser?.email.toLowerCase()
      ) || dbState.customers[0]
    );
  }, [dbState.customers, currentUser]);

  const mySubscriptions = useMemo(() => {
    if (!myCustomer) return [];
    return dbState.subscriptions.filter((s) => s.customerId === myCustomer.id);
  }, [dbState.subscriptions, myCustomer]);

  const myInvoices = useMemo(() => {
    if (!myCustomer) return [];
    return dbState.invoices.filter((i) => i.customerId === myCustomer.id);
  }, [dbState.invoices, myCustomer]);

  const myPayments = useMemo(() => {
    if (!myCustomer) return [];
    return dbState.payments.filter((p) => p.customerId === myCustomer.id);
  }, [dbState.payments, myCustomer]);

  const [profileName, setProfileName] = useState(myCustomer?.name || '');
  const [profilePhone, setProfilePhone] = useState(myCustomer?.phone || '');
  const [profileCompany, setProfileCompany] = useState(myCustomer?.company || '');
  const [profileGstin, setProfileGstin] = useState(myCustomer?.gstin || '');
  const [profileAddress, setProfileAddress] = useState(myCustomer?.billingAddress || '');
  const [pdfInvoice, setPdfInvoice] = useState<Invoice | null>(null);

  const totalOutstandingPaise = myInvoices.reduce((acc, i) => acc + i.balanceDuePaise, 0);

  const handleCustomerSubscriptionAction = async (
    sub: Subscription,
    payload: { action?: string; targetStatus?: SubscriptionStatus }
  ) => {
    const res = await apiRequest(`/api/subscriptions/${sub.id}/lifecycle`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      toast.error(res.error || 'Action not permitted on this plan.');
      return;
    }
    toast.success(`Updated subscription ${sub.subscriptionNumber}!`);
    await refreshState();
  };

  const handlePayInvoiceNow = async (inv: Invoice) => {
    const res = await apiRequest('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoiceId: inv.id,
        paymentMethod: 'UPI',
        amountPaise: inv.balanceDuePaise,
        paymentDate: '2026-10-31',
        transactionReference: `UPI-PORTAL-${Date.now().toString().slice(-6)}`,
        notes: 'Customer Portal self-service settlement',
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Payment failed.');
      return;
    }
    toast.success(`Paid ${formatINR(inv.balanceDuePaise, true)} for ${inv.invoiceNumber}!`);
    await refreshState();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myCustomer) return;
    const res = await apiRequest(`/api/customers/${myCustomer.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: profileName,
        phone: profilePhone,
        company: profileCompany,
        gstin: profileGstin,
        billingAddress: profileAddress,
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not update profile.');
      return;
    }
    toast.success('Updated your customer billing profile.');
    await refreshState();
  };

  // Keep rupeesToPaise referenced
  void rupeesToPaise;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600">
            <UserCheck className="w-4 h-4" />
            <span>Isolated Self-Service Customer Portal</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Welcome, {myCustomer?.name || currentUser?.name}
          </h1>
          <p className="text-xs text-slate-500">
            {myCustomer?.company} · GSTIN: {myCustomer?.gstin || 'Not Provided'} ·Strict customer
            data isolation active
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-right">
          <div className="text-xs text-slate-500">Your Total Outstanding Balance</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
            {formatINR(totalOutstandingPaise, true)}
          </div>
        </div>
      </div>

      {/* Customer Subscriptions */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">Your Subscriptions & Expiry Dates</h2>
          <p className="text-xs text-slate-500">
            Manage eligible pause, resume, and renewal actions permitted by your plan
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                <th className="py-3 px-4">Subscription #</th>
                <th className="py-3 px-4">Plan & Frequency</th>
                <th className="py-3 px-4">Start · Expiry Date</th>
                <th className="py-3 px-4 text-right">Recurring Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Self-Service Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {mySubscriptions.map((sub) => (
                <tr key={sub.id}>
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    {sub.subscriptionNumber}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-slate-900">{sub.planName}</div>
                    <div className="text-[11px] text-slate-500">{sub.billingFrequency}</div>
                  </td>
                  <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600">
                    {formatIndianDate(sub.startDate)} → {formatIndianDate(sub.expiryDate)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {formatINR(sub.totalPaise, true)}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-emerald-700">{sub.status}</td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {sub.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCustomerSubscriptionAction(sub, { targetStatus: 'PAUSED' })
                          }
                          className="px-2.5 py-1 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 rounded inline-flex items-center gap-1"
                        >
                          <Pause className="w-3 h-3" />
                          <span>Pause</span>
                        </button>
                      )}
                      {sub.status === 'PAUSED' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCustomerSubscriptionAction(sub, { targetStatus: 'ACTIVE' })
                          }
                          className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded inline-flex items-center gap-1"
                        >
                          <Play className="w-3 h-3" />
                          <span>Resume</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCustomerSubscriptionAction(sub, { action: 'RENEW' })}
                        className="px-2.5 py-1 text-[11px] font-semibold border border-slate-300 rounded hover:bg-slate-100 inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Renew</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Invoices & Payment History + Profile Update */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">Your GST Invoices</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">Invoice #</th>
                    <th className="py-2.5 px-4">Date · Due</th>
                    <th className="py-2.5 px-4 text-right">Total · Balance</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {myInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600">
                        {formatIndianDate(inv.invoiceDate)} · Due {formatIndianDate(inv.dueDate)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <div className="font-bold text-slate-900">
                          {formatINR(inv.grandTotalPaise, true)}
                        </div>
                        <div
                          className={
                            inv.balanceDuePaise > 0 ? 'text-red-600' : 'text-emerald-700'
                          }
                        >
                          {inv.balanceDuePaise > 0
                            ? `Due: ${formatINR(inv.balanceDuePaise, true)}`
                            : 'Paid ✓'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {inv.balanceDuePaise > 0 && (
                            <button
                              type="button"
                              onClick={() => handlePayInvoiceNow(inv)}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 text-white rounded inline-flex items-center gap-1"
                            >
                              <CreditCard className="w-3 h-3" />
                              <span>Pay via UPI</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPdfInvoice(inv)}
                            className="px-2.5 py-1 text-[11px] font-medium border border-slate-300 rounded hover:bg-slate-100 inline-flex items-center gap-1"
                          >
                            <Printer className="w-3 h-3" />
                            <span>PDF</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">Your Payment History</h2>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">Payment #</th>
                  <th className="py-2.5 px-4">Invoice</th>
                  <th className="py-2.5 px-4">Method · Date</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {myPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {p.paymentNumber}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">{p.invoiceNumber}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {p.paymentMethod} · {formatIndianDate(p.paymentDate)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                      {formatINR(p.amountPaise, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Profile Editor */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Update Account & Billing Profile</h2>
          <p className="text-xs text-slate-500 mb-4">
            Changes immediately reflect on future GST tax invoices
          </p>
          <form onSubmit={handleSaveProfile} className="space-y-3 text-xs">
            <div>
              <label htmlFor="cp-name" className="block font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="cp-name"
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="cp-comp" className="block font-medium text-slate-700 mb-1">
                Company / Organization
              </label>
              <input
                id="cp-comp"
                type="text"
                value={profileCompany}
                onChange={(e) => setProfileCompany(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cp-phone" className="block font-medium text-slate-700 mb-1">
                  Phone Number
                </label>
                <input
                  id="cp-phone"
                  type="text"
                  value={profilePhone}
                  onChange={(e) => setProfilePhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="cp-gst" className="block font-medium text-slate-700 mb-1">
                  GSTIN
                </label>
                <input
                  id="cp-gst"
                  type="text"
                  value={profileGstin}
                  onChange={(e) => setProfileGstin(e.target.value)}
                  className="w-full px-3 py-2 font-mono uppercase border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label htmlFor="cp-addr" className="block font-medium text-slate-700 mb-1">
                Billing Address
              </label>
              <textarea
                id="cp-addr"
                rows={2}
                value={profileAddress}
                onChange={(e) => setProfileAddress(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg inline-flex items-center justify-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Profile Changes</span>
            </button>
          </form>
        </div>
      </div>

      {/* Customer PDF Invoice Modal */}
      {pdfInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-xl w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <span className="text-sm font-bold text-slate-900">
                Invoice {pdfInvoice.invoiceNumber}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg"
                >
                  Print / Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => setPdfInvoice(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>
            <div id="printable-invoice" className="space-y-3 text-xs">
              <div className="font-bold text-slate-900">
                Billed To: {pdfInvoice.customerName}
              </div>
              <div className="font-mono text-slate-600">
                Subtotal: {formatINR(pdfInvoice.subtotalPaise, true)} · Tax:{' '}
                {formatINR(pdfInvoice.taxPaise, true)} · Discount: -
                {formatINR(pdfInvoice.discountPaise, true)}
              </div>
              <div className="text-sm font-bold font-mono text-indigo-700">
                Grand Total: {formatINR(pdfInvoice.grandTotalPaise, true)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
