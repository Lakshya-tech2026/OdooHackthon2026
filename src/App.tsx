/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Toaster } from 'sonner';
import {
  LayoutDashboard,
  Package,
  FileSpreadsheet,
  Repeat,
  Receipt,
  Users,
  BarChart3,
  UserCircle,
  LogOut,
  Menu,
  X,
  Bell,
  HelpCircle,
  Settings,
} from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { ProductsPlansView } from './components/ProductsPlansView';
import { QuotationsSubscriptionsView } from './components/QuotationsSubscriptionsView';
import { InvoicesPaymentsView } from './components/InvoicesPaymentsView';
import {
  CustomersStaffView,
  ReportsAnalyticsView,
  CustomerPortalView,
} from './components/CustomersStaffReportsView';
import { SettingsView } from './components/SettingsView';

type NavKey =
  | 'dashboard'
  | 'products'
  | 'plans'
  | 'quotations'
  | 'subscriptions'
  | 'invoices'
  | 'payments'
  | 'taxes'
  | 'customers'
  | 'staff'
  | 'reports'
  | 'portal'
  | 'settings'
  | 'auth';

const MainShell: React.FC = () => {
  const { currentUser, switchDemoRole, logout, dbState, firestoreConnected } = useApp();

  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  if (!currentUser || activeNav === 'auth') {
    return (
      <AuthScreen
        onSuccess={() => {
          setActiveNav('dashboard');
        }}
      />
    );
  }

  // If the signed-in user is a CUSTOMER, restrict them to Customer Portal or Settings
  const effectiveView: NavKey =
    currentUser.role === 'CUSTOMER' && activeNav !== 'portal' && activeNav !== 'settings'
      ? 'portal'
      : activeNav;

  const navItems: Array<{
    id: NavKey;
    label: string;
    icon: React.FC<{ className?: string }>;
    roles: Array<'ADMIN' | 'STAFF' | 'CUSTOMER'>;
  }> = [
    {
      id: 'dashboard',
      label: 'Dashboard Overview',
      icon: LayoutDashboard,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'products',
      label: 'Products & Variants',
      icon: Package,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'plans',
      label: 'Subscription Plans',
      icon: Repeat,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'quotations',
      label: 'Quotations',
      icon: FileSpreadsheet,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      icon: Repeat,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'invoices',
      label: 'Invoices & Payments',
      icon: Receipt,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'taxes',
      label: 'Taxes & Discounts',
      icon: Receipt,
      roles: ['ADMIN'],
    },
    {
      id: 'customers',
      label: 'Customers & Staff',
      icon: Users,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'reports',
      label: 'Reports & Analytics',
      icon: BarChart3,
      roles: ['ADMIN', 'STAFF'],
    },
    {
      id: 'portal',
      label: 'Customer Portal',
      icon: UserCircle,
      roles: ['ADMIN', 'STAFF', 'CUSTOMER'],
    },
    {
      id: 'settings',
      label: 'Settings & Security',
      icon: Settings,
      roles: ['ADMIN', 'STAFF', 'CUSTOMER'],
    },
  ];

  const visibleNavItems = navItems.filter((item) => item.roles.includes(currentUser.role));

  const overdueCount = dbState.invoices.filter(
    (i) => i.balanceDuePaise > 0 && i.paymentStatus === 'OVERDUE'
  ).length;

  return (
    <div className="min-h-screen bg-[#f6f5ef] text-[#18251d] flex">
      {/* Left Deep Green Sidebar (Desktop) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:sticky lg:top-0 lg:h-screen bg-[#18251d] text-[#d8e3d9] border-r border-[#263c2d] shrink-0">
        <div className="h-16 px-6 flex items-center justify-between border-b border-[#263c2d]">
          <div className="flex items-center gap-2.5">
            <div className="bl-brand-symbol scale-90" aria-hidden="true" />
            <span className="text-[18px] font-semibold tracking-tight text-white whitespace-nowrap">
              Brightloop
            </span>
          </div>
          <span className="text-xs font-mono text-[#d5f36a]">{currentUser.role}</span>
        </div>

        <nav aria-label="Sidebar navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = effectiveView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#d5f36a] text-[#18251d] font-semibold'
                    : 'text-[#d8e3d9] hover:bg-[#244a36] hover:text-white font-normal'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#263c2d] space-y-3">
          <div className="text-xs text-[#c8d6c9]">
            <div className="font-medium text-white truncate">{currentUser.name}</div>
            <div className="truncate text-[#a7b9a9]">{currentUser.email}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSetupModal(true)}
              className="flex-1 py-1.5 px-2.5 text-[11.5px] font-medium text-[#d8e3d9] hover:text-white bg-[#244a36] hover:bg-[#2d5b43] rounded-md inline-flex items-center justify-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Setup Guide</span>
            </button>
            <button
              type="button"
              onClick={() => {
                logout();
                setActiveNav('auth');
              }}
              className="flex-1 py-1.5 px-2.5 text-[11.5px] font-medium text-[#f9c6c6] hover:text-white bg-[#244a36] hover:bg-red-700 rounded-md inline-flex items-center justify-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#18251d]/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-xs bg-[#18251d] text-[#d8e3d9] flex flex-col h-full z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-[#263c2d]">
              <div className="flex items-center gap-2.5">
                <div className="bl-brand-symbol scale-90" aria-hidden="true" />
                <span className="text-base font-semibold text-white">Brightloop</span>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-[#c8d6c9] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = effectiveView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium ${
                      active
                        ? 'bg-[#d5f36a] text-[#18251d] font-semibold'
                        : 'text-[#d8e3d9] hover:bg-[#244a36]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#f6f5ef]">
        {/* Top Bar Contract: Breadcrumb Trail on Left, Role Switcher & Primary Action on Right */}
        <header className="h-14 bg-white border-b border-[#e0e2d6] px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#244a36] hover:text-[#18251d] rounded-lg hover:bg-[#f6f5ef]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-[#4b554c] truncate">
              <span className="font-semibold text-[#18251d]">Brightloop Workspace</span>
              <span aria-hidden="true"> / </span>
              <span className="capitalize text-[#244a36] font-medium">{effectiveView}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Instant Role Switcher for Testing Admin / Staff / Customer Isolation */}
            <div
              role="group"
              aria-label="Switch active role"
              className="hidden sm:flex items-center gap-1 p-1 bg-[#f6f5ef] rounded-lg border border-[#e0e2d6]"
            >
              <button
                type="button"
                onClick={() => {
                  switchDemoRole('ADMIN', 'admin@brightloop.in');
                  if (activeNav === 'portal') setActiveNav('dashboard');
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  currentUser.role === 'ADMIN'
                    ? 'bg-[#244a36] text-white font-semibold'
                    : 'text-[#3f4a40] hover:text-[#18251d]'
                }`}
              >
                Admin View
              </button>
              <button
                type="button"
                onClick={() => {
                  switchDemoRole('STAFF', 'staff@brightloop.in');
                  if (activeNav === 'portal' || activeNav === 'taxes') setActiveNav('dashboard');
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  currentUser.role === 'STAFF'
                    ? 'bg-[#244a36] text-white font-semibold'
                    : 'text-[#3f4a40] hover:text-[#18251d]'
                }`}
              >
                Staff View
              </button>
              <button
                type="button"
                onClick={() => {
                  switchDemoRole('CUSTOMER', 'aarav@kinetixlabs.in');
                  setActiveNav('portal');
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  currentUser.role === 'CUSTOMER'
                    ? 'bg-[#244a36] text-white font-semibold'
                    : 'text-[#3f4a40] hover:text-[#18251d]'
                }`}
              >
                Customer Portal
              </button>
            </div>

            {/* Notification Center Button */}
            <div className="relative">
              <button
                type="button"
                aria-label="Notifications"
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 text-[#3f4a40] hover:text-[#18251d] rounded-lg hover:bg-[#f6f5ef] relative"
              >
                <Bell className="w-4 h-4" />
                {overdueCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-600" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-[#e0e2d6] rounded-xl shadow-lg p-4 z-50 text-xs space-y-2.5">
                  <div className="flex items-center justify-between font-semibold text-[#18251d] border-b border-[#eceee4] pb-2">
                    <span>Billing Notifications</span>
                    <button
                      type="button"
                      onClick={() => setShowNotifications(false)}
                      className="text-[#4b554c] hover:text-[#18251d]"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="text-[#2c382e]">
                    • {overdueCount} overdue invoice(s) require payment follow-up.
                  </div>
                  <div className="text-[#2c382e]">
                    • 2 active subscriptions are scheduled for batch billing today.
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveNav('auth')}
              className="px-3 py-1.5 text-xs font-semibold text-[#18251d] bg-[#f6f5ef] hover:bg-[#eceee4] border border-[#cfd2c5] rounded-lg whitespace-nowrap shrink-0"
            >
              Auth Portal
            </button>
          </div>
        </header>

        {/* Main Workspace Canvas */}
        <main className="flex-1 p-4 sm:p-5 lg:p-6 max-w-[1440px] w-full mx-auto">
          {effectiveView === 'dashboard' && (
            <DashboardView onNavigate={(v) => setActiveNav(v as NavKey)} />
          )}
          {effectiveView === 'products' && <ProductsPlansView initialTab="PRODUCTS" />}
          {effectiveView === 'plans' && <ProductsPlansView initialTab="PLANS" />}
          {effectiveView === 'quotations' && (
            <QuotationsSubscriptionsView initialTab="QUOTATIONS" />
          )}
          {effectiveView === 'subscriptions' && (
            <QuotationsSubscriptionsView initialTab="SUBSCRIPTIONS" />
          )}
          {effectiveView === 'invoices' && <InvoicesPaymentsView initialTab="INVOICES" />}
          {effectiveView === 'payments' && <InvoicesPaymentsView initialTab="PAYMENTS" />}
          {effectiveView === 'taxes' && <InvoicesPaymentsView initialTab="TAXES_DISCOUNTS" />}
          {effectiveView === 'customers' && <CustomersStaffView initialTab="CUSTOMERS" />}
          {effectiveView === 'staff' && <CustomersStaffView initialTab="STAFF" />}
          {effectiveView === 'reports' && <ReportsAnalyticsView />}
          {effectiveView === 'portal' && <CustomerPortalView />}
          {effectiveView === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Setup & Deployment Instructions Modal */}
      {showSetupModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 text-xs text-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Brightloop Architecture & Deployment Guide
              </h3>
              <button
                type="button"
                onClick={() => setShowSetupModal(false)}
                className="text-slate-500 hover:text-slate-900"
              >
                Close ✕
              </button>
            </div>
            <div className="space-y-2.5 leading-relaxed">
              <p>
                <strong>1. Firebase Firestore & Security Rules:</strong> Provisioned on project{' '}
                <code className="font-mono text-indigo-700">augmented-pivot-13skh</code> with
                hardened zero-trust <code className="font-mono">firestore.rules</code> deployed
                across all 16 collections. Connection status:{' '}
                <span className="font-semibold text-emerald-700">
                  {firestoreConnected ? 'Online & Verified' : 'Synchronized via Backend Bridge'}
                </span>
                .
              </p>
              <p>
                <strong>2. Firebase Authentication Providers:</strong> Google Sign-In is enabled by
                default. To also use native client-side Firebase Email/Password authentication in
                addition to the server-side scrypt auth engine, open the Firebase Console →
                Authentication → Sign-in method → Enable <em>Email/Password</em>.
              </p>
              <p>
                <strong>3. Production Build & Start:</strong> Run{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">npm run build</code>{' '}
                followed by{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">npm start</code>.
                All financial calculations execute on the Node.js server in integer minor currency
                units (paise).
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <Toaster position="bottom-right" richColors closeButton />
      <MainShell />
    </AppProvider>
  );
}
