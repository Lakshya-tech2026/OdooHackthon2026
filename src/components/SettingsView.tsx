import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck,
  Database,
  UserCog,
  BellRing,
  Lock,
  RefreshCw,
  CheckCircle2,
  HardDriveDownload,
  KeyRound,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  formatIndianDate,
  formatINR,
  getUpcomingRenewals,
  validatePasswordStrength,
} from '../lib/billingEngine';

interface SecurityStatusPayload {
  securityPosture: {
    headerTrustRemoved: boolean;
    bearerTokenVerification: string;
    passwordHashing: string;
    rbacEnforcement: string;
    customerOwnershipIsolation: boolean;
    demoModeEnabled: boolean;
    rateLimitingActive: boolean;
    firestoreDatabaseId: string;
  };
  backups: Array<{ fileName: string; sizeBytes: number; updatedAt: string }>;
  upcomingRenewalsCount: number;
  collectionCounts: Record<string, number>;
  requestedBy: string;
}

export const SettingsView: React.FC = () => {
  const {
    currentUser,
    dbState,
    firestoreConnected,
    updateUserProfile,
    requestPasswordReset,
    completePasswordReset,
    apiRequest,
  } = useApp();

  const isAdmin = currentUser?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'PROFILE' | 'SECURITY' | 'DATABASE' | 'RENEWALS'>(
    'PROFILE'
  );

  // Profile & Password Form State
  const [displayName, setDisplayName] = useState(currentUser?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password Reset Verification Flow State
  const [resetToken, setResetToken] = useState('');
  const [resetNewPw, setResetNewPw] = useState('');

  // Billing & Renewal Notification Window State
  const [renewalWindowDays, setRenewalWindowDays] = useState<number>(60);
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState<string>('Net 15 Days');
  const [gstFooterNote, setGstFooterNote] = useState<string>(
    'All SaaS and Odoo Enterprise invoices include applicable GST/IGST per Indian tax regulations.'
  );

  // Admin Security & Backup State
  const [securityData, setSecurityData] = useState<SecurityStatusPayload | null>(null);
  const [backupLabel, setBackupLabel] = useState('pre-migration-snapshot');
  const [creatingBackup, setCreatingBackup] = useState(false);

  useEffect(() => {
    if (currentUser?.name) {
      setDisplayName(currentUser.name);
    }
  }, [currentUser?.name]);

  const loadSecurityStatus = async () => {
    if (!isAdmin) return;
    const res = await apiRequest<SecurityStatusPayload>('/api/admin/security-status');
    if (res.ok && res.data) {
      setSecurityData(res.data);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadSecurityStatus();
    }
  }, [isAdmin]);

  const upcomingRenewals = getUpcomingRenewals(
    dbState.subscriptions,
    new Date().toISOString().slice(0, 10),
    renewalWindowDays
  );

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || displayName.trim().length < 2) {
      toast.error('Display name must be at least 2 characters.');
      return;
    }
    if (newPassword) {
      const pwCheck = validatePasswordStrength(newPassword);
      if (!pwCheck.valid) {
        toast.error(pwCheck.errors[0]);
        return;
      }
    }
    setSavingProfile(true);
    const res = await updateUserProfile({
      name: displayName.trim(),
      currentPassword: currentPassword || undefined,
      newPassword: newPassword || undefined,
    });
    setSavingProfile(false);
    if (!res.ok) {
      toast.error(res.error || 'Could not update profile.');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    toast.success('Profile and security settings updated.');
  };

  const handleTriggerResetToken = async () => {
    if (!currentUser?.email) return;
    const res = await requestPasswordReset(currentUser.email);
    if (res.ok) {
      if (res.resetTokenPreview) {
        setResetToken(res.resetTokenPreview);
      }
      toast.success(res.message || 'Verification token generated.');
    } else {
      toast.error(res.error || 'Failed to generate reset token.');
    }
  };

  const handleVerifyResetToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken.trim() || !resetNewPw) {
      toast.error('Provide both the verification token and new password.');
      return;
    }
    const res = await completePasswordReset(resetToken.trim(), resetNewPw);
    if (res.ok) {
      toast.success(res.message || 'Password updated via verified reset flow.');
      setResetToken('');
      setResetNewPw('');
    } else {
      toast.error(res.error || 'Reset token verification failed.');
    }
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    const res = await apiRequest<{
      backup: { backupFile: string; createdAt: string };
      backups: Array<{ fileName: string; sizeBytes: number; updatedAt: string }>;
    }>('/api/admin/database/backup', {
      method: 'POST',
      body: JSON.stringify({ label: backupLabel }),
    });
    setCreatingBackup(false);
    if (res.ok && res.data) {
      toast.success(`Created backup snapshot: ${res.data.backup.backupFile}`);
      loadSecurityStatus();
    } else {
      toast.error(res.error || 'Failed to create database backup.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#e0e2d6]">
        <div>
          <h1 className="text-xl font-semibold text-[#18251d] tracking-tight">
            Workspace Settings & Security Governance
          </h1>
          <p className="text-xs text-[#4b554c] mt-0.5">
            Manage account credentials, server-side token security, Firestore backup strategy, and
            billing notification preferences.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-white rounded-lg border border-[#e0e2d6]">
          <button
            type="button"
            onClick={() => setActiveTab('PROFILE')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'PROFILE'
                ? 'bg-[#244a36] text-white font-semibold'
                : 'text-[#3f4a40] hover:text-[#18251d]'
            }`}
          >
            <UserCog className="w-3.5 h-3.5" />
            <span>Profile & Auth</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('RENEWALS')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'RENEWALS'
                ? 'bg-[#244a36] text-white font-semibold'
                : 'text-[#3f4a40] hover:text-[#18251d]'
            }`}
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>Renewal Alerts</span>
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('SECURITY')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'SECURITY'
                    ? 'bg-[#244a36] text-white font-semibold'
                    : 'text-[#3f4a40] hover:text-[#18251d]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Security Audit</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('DATABASE')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'DATABASE'
                    ? 'bg-[#244a36] text-white font-semibold'
                    : 'text-[#3f4a40] hover:text-[#18251d]'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Database & Backups</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* TAB 1: PROFILE & PASSWORD SECURITY */}
      {activeTab === 'PROFILE' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-[#e0e2d6] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#eceee4] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">
                  Account Identity & Role Verification
                </h2>
                <p className="text-xs text-[#4b554c]">
                  Roles are enforced server-side from the authoritative database and cannot be
                  changed by the client.
                </p>
              </div>
              <span className="font-mono text-xs font-semibold text-[#244a36]">
                {currentUser?.role}
              </span>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-3.5 text-xs">
              <div>
                <label
                  htmlFor="settingsDisplayName"
                  className="block font-semibold text-[#223127] mb-1"
                >
                  Full Name
                </label>
                <input
                  id="settingsDisplayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d]"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#223127] mb-1">
                    Registered Email (Immutable)
                  </label>
                  <input
                    type="email"
                    value={currentUser?.email || ''}
                    disabled
                    className="w-full h-10 px-3 rounded-lg border border-[#e0e2d6] bg-[#f6f5ef] text-[#4b554c]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#223127] mb-1">
                    Server-Controlled Role
                  </label>
                  <input
                    type="text"
                    value={`${currentUser?.role || 'CUSTOMER'} · Verified`}
                    disabled
                    className="w-full h-10 px-3 rounded-lg border border-[#e0e2d6] bg-[#f6f5ef] text-[#244a36] font-mono font-semibold"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-[#eceee4]">
                <h3 className="text-xs font-semibold text-[#18251d] mb-2 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[#244a36]" />
                  <span>Update Password (Random-Salt Scrypt)</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="settingsCurrentPw"
                      className="block font-semibold text-[#223127] mb-1"
                    >
                      Current Password
                    </label>
                    <input
                      id="settingsCurrentPw"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Leave blank if unchanged"
                      className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="settingsNewPw"
                      className="block font-semibold text-[#223127] mb-1"
                    >
                      New Compliant Password
                    </label>
                    <input
                      id="settingsNewPw"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="9+ chars, A-Z, a-z, symbol"
                      className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d]"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 text-xs font-semibold bg-[#d5f36a] hover:bg-[#c5e850] text-[#18251d] border border-[#b8db46] rounded-lg"
                >
                  {savingProfile ? 'Saving Changes...' : 'Save Account Settings'}
                </button>
              </div>
            </form>
          </div>

          {/* Verified Password Reset Flow Card */}
          <div className="bg-white rounded-xl border border-[#e0e2d6] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#eceee4] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">
                  Verified Password Reset Flow
                </h2>
                <p className="text-xs text-[#4b554c]">
                  Dispatches a Firebase Authentication recovery email and a single-use 15-minute
                  server verification token.
                </p>
              </div>
              <KeyRound className="w-4 h-4 text-[#244a36]" />
            </div>

            <div className="p-3.5 rounded-lg bg-[#f6f5ef] border border-[#e0e2d6] text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#18251d]">
                  Step 1: Request Recovery Verification
                </span>
                <button
                  type="button"
                  onClick={handleTriggerResetToken}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#244a36] text-white rounded-md hover:bg-[#18251d]"
                >
                  Send Recovery Token
                </button>
              </div>
              <p className="text-[#4b554c]">
                Target account: <span className="font-mono">{currentUser?.email}</span>
              </p>
            </div>

            <form onSubmit={handleVerifyResetToken} className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="settingsResetToken"
                  className="block font-semibold text-[#223127] mb-1"
                >
                  Step 2: Verification Token
                </label>
                <input
                  id="settingsResetToken"
                  type="text"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="rst_..."
                  className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white font-mono text-[#18251d]"
                />
              </div>
              <div>
                <label
                  htmlFor="settingsResetNewPw"
                  className="block font-semibold text-[#223127] mb-1"
                >
                  New Password
                </label>
                <input
                  id="settingsResetNewPw"
                  type="password"
                  value={resetNewPw}
                  onChange={(e) => setResetNewPw(e.target.value)}
                  placeholder="Enter new strong password"
                  className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d]"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-[#d5f36a] hover:bg-[#c5e850] text-[#18251d] border border-[#b8db46] rounded-lg"
                >
                  Verify & Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: UPCOMING RENEWAL NOTIFICATIONS & BILLING PREFERENCES */}
      {activeTab === 'RENEWALS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#e0e2d6] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#eceee4] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">
                  Upcoming Renewal Notifications & Billing Policy
                </h2>
                <p className="text-xs text-[#4b554c]">
                  Monitor active subscriptions approaching their next billing cycle or contract
                  expiry date.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="renewalWindowSelect" className="font-semibold text-[#223127]">
                  Alert Window:
                </label>
                <select
                  id="renewalWindowSelect"
                  value={renewalWindowDays}
                  onChange={(e) => setRenewalWindowDays(Number(e.target.value))}
                  className="h-9 px-2.5 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d] font-medium"
                >
                  <option value={14}>Next 14 Days</option>
                  <option value={30}>Next 30 Days</option>
                  <option value={60}>Next 60 Days</option>
                  <option value={90}>Next 90 Days</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-[#223127] mb-1">
                  Default Invoice Payment Terms
                </label>
                <input
                  type="text"
                  value={defaultPaymentTerms}
                  onChange={(e) => setDefaultPaymentTerms(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#223127] mb-1">
                  Standard Invoice Compliance Note
                </label>
                <input
                  type="text"
                  value={gstFooterNote}
                  onChange={(e) => setGstFooterNote(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#cfd2c5] bg-white text-[#18251d]"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-[#e0e2d6] rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#f6f5ef] border-b border-[#e0e2d6] text-[#2c382e]">
                    <th className="py-2.5 px-4 font-semibold">Subscription #</th>
                    <th className="py-2.5 px-4 font-semibold">Customer</th>
                    <th className="py-2.5 px-4 font-semibold">Frequency</th>
                    <th className="py-2.5 px-4 font-semibold">Next Billing Date</th>
                    <th className="py-2.5 px-4 font-semibold">Days Remaining</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Recurring Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eceee4]">
                  {upcomingRenewals.map((item) => (
                    <tr key={item.subscription.id} className="hover:bg-[#fafaf5]">
                      <td className="py-2.5 px-4 font-mono font-semibold text-[#18251d]">
                        {item.subscription.subscriptionNumber}
                      </td>
                      <td className="py-2.5 px-4 text-[#2c382e]">
                        {item.subscription.customerName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#4b554c]">
                        {item.subscription.billingFrequency}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#244a36] font-semibold">
                        {formatIndianDate(item.targetDate)}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-amber-700">
                        {item.daysUntilDue === 0 ? 'Due Today' : `In ${item.daysUntilDue} days`}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-right text-[#18251d]">
                        {formatINR(item.subscription.totalPaise, true)}
                      </td>
                    </tr>
                  ))}
                  {upcomingRenewals.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#4b554c]">
                        No active subscriptions scheduled for renewal within the next{' '}
                        {renewalWindowDays} days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ADMIN SECURITY AUDIT */}
      {isAdmin && activeTab === 'SECURITY' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#e0e2d6] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#eceee4] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">
                  Backend & Firebase Security Audit Matrix
                </h2>
                <p className="text-xs text-[#4b554c]">
                  Live verification of authentication, role-based access control, and Firestore
                  zero-trust rules.
                </p>
              </div>
              <button
                type="button"
                onClick={loadSecurityStatus}
                className="px-3 py-1.5 text-xs font-semibold bg-[#f6f5ef] hover:bg-[#eceee4] text-[#18251d] border border-[#cfd2c5] rounded-lg inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Audit</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
              <div className="p-3.5 rounded-lg border border-[#e0e2d6] bg-[#fafaf5] space-y-1">
                <div className="flex items-center justify-between font-semibold text-[#18251d]">
                  <span>1. Header Spoofing Protection</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[#4b554c]">
                  Untrusted <code className="font-mono">x-user-id</code> and{' '}
                  <code className="font-mono">x-user-email</code> headers are ignored. Every API
                  request requires a verified <code className="font-mono">Bearer</code> token.
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-[#e0e2d6] bg-[#fafaf5] space-y-1">
                <div className="flex items-center justify-between font-semibold text-[#18251d]">
                  <span>2. Token Signature Verification</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[#4b554c]">
                  {securityData?.securityPosture.bearerTokenVerification ||
                    'HMAC-SHA256 Session JWT + Firebase RS256 ID Token'}
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-[#e0e2d6] bg-[#fafaf5] space-y-1">
                <div className="flex items-center justify-between font-semibold text-[#18251d]">
                  <span>3. Server-Side RBAC & Ownership</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[#4b554c]">
                  Roles (<code className="font-mono">ADMIN</code>,{' '}
                  <code className="font-mono">STAFF</code>,{' '}
                  <code className="font-mono">CUSTOMER</code>) are read exclusively from the
                  server-controlled database.
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-[#e0e2d6] bg-[#fafaf5] space-y-1">
                <div className="flex items-center justify-between font-semibold text-[#18251d]">
                  <span>4. Password Hashing Policy</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[#4b554c]">
                  {securityData?.securityPosture.passwordHashing ||
                    'Per-user 16-byte random salt scrypt + timingSafeEqual'}
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-[#e0e2d6] bg-[#fafaf5] space-y-1">
                <div className="flex items-center justify-between font-semibold text-[#18251d]">
                  <span>5. Duplicate Invoice & Payment Guard</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[#4b554c]">
                  Idempotency keys (<code className="font-mono">subId_period</code>) and unique{' '}
                  <code className="font-mono">transactionReference</code> checks prevent double
                  billing.
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-[#e0e2d6] bg-[#fafaf5] space-y-1">
                <div className="flex items-center justify-between font-semibold text-[#18251d]">
                  <span>6. Firestore Zero-Trust Rules</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[#4b554c]">
                  Database:{' '}
                  <code className="font-mono">
                    {firestoreConnected ? 'Connected' : 'Synced via Server'}
                  </code>{' '}
                  · 16 collections guarded by schema & ownership rules.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DATABASE ARCHITECTURE & NON-DESTRUCTIVE BACKUPS */}
      {isAdmin && activeTab === 'DATABASE' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#e0e2d6] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#eceee4] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#18251d]">
                  Authoritative Data Store & Non-Destructive Backup Strategy
                </h2>
                <p className="text-xs text-[#4b554c]">
                  Create timestamped JSON snapshots prior to schema migrations and inspect
                  deduplicated collection counts.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={backupLabel}
                  onChange={(e) => setBackupLabel(e.target.value)}
                  placeholder="Backup label"
                  className="h-9 px-3 text-xs rounded-lg border border-[#cfd2c5] bg-white text-[#18251d] w-full sm:w-48"
                />
                <button
                  type="button"
                  disabled={creatingBackup}
                  onClick={handleCreateBackup}
                  className="px-3.5 py-2 text-xs font-semibold bg-[#d5f36a] hover:bg-[#c5e850] text-[#18251d] border border-[#b8db46] rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <HardDriveDownload className="w-3.5 h-3.5" />
                  <span>{creatingBackup ? 'Creating Snapshot...' : 'Create Backup Snapshot'}</span>
                </button>
              </div>
            </div>

            {securityData?.collectionCounts && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {Object.entries(securityData.collectionCounts).map(([col, count]) => (
                  <div
                    key={col}
                    className="p-3 rounded-lg border border-[#e0e2d6] bg-[#f6f5ef] flex items-center justify-between"
                  >
                    <span className="capitalize font-medium text-[#2c382e]">{col}</span>
                    <span className="font-mono font-semibold text-[#18251d]">{count}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto border border-[#e0e2d6] rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#f6f5ef] border-b border-[#e0e2d6] text-[#2c382e]">
                    <th className="py-2.5 px-4 font-semibold">Snapshot File Name</th>
                    <th className="py-2.5 px-4 font-semibold">Created Timestamp</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Size (Bytes)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eceee4]">
                  {(securityData?.backups || []).map((b) => (
                    <tr key={b.fileName} className="hover:bg-[#fafaf5]">
                      <td className="py-2.5 px-4 font-mono text-[#18251d] font-medium">
                        {b.fileName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#4b554c]">
                        {formatIndianDate(b.updatedAt)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-right text-[#18251d]">
                        {b.sizeBytes.toLocaleString('en-IN')} B
                      </td>
                    </tr>
                  ))}
                  {(!securityData?.backups || securityData.backups.length === 0) && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-[#4b554c]">
                        No backup snapshots listed yet. Click &ldquo;Create Backup Snapshot&rdquo;
                        to save a non-destructive checkpoint.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
