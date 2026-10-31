import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  ArrowUpDown,
  Trash2,
  Edit3,
  Layers,
  Calculator,
  Power,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  calculateVariantUnitPricePaise,
  formatINR,
  formatIndianDate,
  rupeesToPaise,
} from '../lib/billingEngine';
import { BillingFrequency, Plan, Product, ProductType } from '../types/domain';

export const ProductsPlansView: React.FC<{ initialTab?: 'PRODUCTS' | 'PLANS' }> = ({
  initialTab = 'PRODUCTS',
}) => {
  const { dbState, currentUser, apiRequest, refreshState } = useApp();
  const isAdmin = currentUser?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'PLANS'>(initialTab);

  // Products Table State
  const [prodSearch, setProdSearch] = useState('');
  const [prodTypeFilter, setProdTypeFilter] = useState<string>('ALL');
  const [prodSortAsc, setProdSortAsc] = useState(true);
  const [prodPage, setProdPage] = useState(1);
  const pageSize = 6;

  // Interactive Variant Price Simulator State
  const [selectedSimProductId, setSelectedSimProductId] = useState<string>('prod_101');
  const [selectedSimVariantId, setSelectedSimVariantId] = useState<string>('var_101');

  // Product Modal State
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodType, setProdType] = useState<ProductType>('SAAS');
  const [prodSalesRupees, setProdSalesRupees] = useState('1000');
  const [prodCostRupees, setProdCostRupees] = useState('350');
  const [prodDesc, setProdDesc] = useState('');
  const [newVariantAttr, setNewVariantAttr] = useState('Brand');
  const [newVariantVal, setNewVariantVal] = useState('Odoo');
  const [newVariantExtraRupees, setNewVariantExtraRupees] = useState('560');

  // Add Variant to Existing Product Modal
  const [variantTargetProductId, setVariantTargetProductId] = useState<string | null>(null);
  const [varAttrName, setVarAttrName] = useState('Brand');
  const [varAttrVal, setVarAttrVal] = useState('');
  const [varAddRupees, setVarAddRupees] = useState('500');

  // Plan Table & Modal State
  const [planSearch, setPlanSearch] = useState('');
  const [planFreqFilter, setPlanFreqFilter] = useState<string>('ALL');
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planPriceRupees, setPlanPriceRupees] = useState('1560');
  const [planFreq, setPlanFreq] = useState<BillingFrequency>('MONTHLY');
  const [planMinQty, setPlanMinQty] = useState('1');
  const [planFrom, setPlanFrom] = useState('2026-01-01');
  const [planUntil, setPlanUntil] = useState('2027-12-31');
  const [planAutoClose, setPlanAutoClose] = useState('30');
  const [planAllowEarly, setPlanAllowEarly] = useState(true);
  const [planAllowPause, setPlanAllowPause] = useState(true);
  const [planAllowRenew, setPlanAllowRenew] = useState(true);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<
    { type: 'PRODUCT'; item: Product } | { type: 'PLAN'; item: Plan } | null
  >(null);

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    return dbState.products
      .filter((p) => {
        if (prodTypeFilter !== 'ALL' && p.productType !== prodTypeFilter) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        prodSortAsc
          ? a.salesPricePaise - b.salesPricePaise
          : b.salesPricePaise - a.salesPricePaise
      );
  }, [dbState.products, prodSearch, prodTypeFilter, prodSortAsc]);

  const paginatedProducts = useMemo(() => {
    const start = (prodPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, prodPage]);

  const simProduct =
    dbState.products.find((p) => p.id === selectedSimProductId) || dbState.products[0];
  const simProductVariants = useMemo(
    () => dbState.productVariants.filter((v) => v.productId === simProduct?.id),
    [dbState.productVariants, simProduct]
  );
  const simVariant =
    simProductVariants.find((v) => v.id === selectedSimVariantId) || simProductVariants[0] || null;
  const simTotalPaise = simProduct ? calculateVariantUnitPricePaise(simProduct, simVariant) : 0;

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    return dbState.plans.filter((p) => {
      if (planFreqFilter !== 'ALL' && p.billingFrequency !== planFreqFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [dbState.plans, planSearch, planFreqFilter]);

  const openCreateProduct = () => {
    setEditingProduct(null);
    setProdName('');
    setProdType('SAAS');
    setProdSalesRupees('1000');
    setProdCostRupees('350');
    setProdDesc('');
    setNewVariantAttr('Brand');
    setNewVariantVal('');
    setNewVariantExtraRupees('560');
    setShowProductModal(true);
  };

  const openEditProduct = (prod: Product) => {
    setEditingProduct(prod);
    setProdName(prod.name);
    setProdType(prod.productType);
    setProdSalesRupees(String(prod.salesPricePaise / 100));
    setProdCostRupees(String(prod.costPricePaise / 100));
    setProdDesc(prod.description || '');
    setShowProductModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) {
      toast.error('Product name is required.');
      return;
    }
    const salesPaise = rupeesToPaise(Number(prodSalesRupees));
    const costPaise = rupeesToPaise(Number(prodCostRupees));

    if (editingProduct) {
      const res = await apiRequest(`/api/products/${editingProduct.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: prodName,
          productType: prodType,
          salesPricePaise: salesPaise,
          costPricePaise: costPaise,
          description: prodDesc,
        }),
      });
      if (!res.ok) {
        toast.error(res.error || 'Could not update product.');
        return;
      }
      toast.success(`Updated product "${prodName}"`);
    } else {
      const variants =
        newVariantAttr.trim() && newVariantVal.trim()
          ? [
              {
                attributeName: newVariantAttr.trim(),
                attributeValue: newVariantVal.trim(),
                additionalPricePaise: rupeesToPaise(Number(newVariantExtraRupees || 0)),
              },
            ]
          : [];

      const res = await apiRequest('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          name: prodName,
          productType: prodType,
          salesPricePaise: salesPaise,
          costPricePaise: costPaise,
          description: prodDesc,
          variants,
        }),
      });
      if (!res.ok) {
        toast.error(res.error || 'Could not create product.');
        return;
      }
      toast.success(`Created product "${prodName}"`);
    }

    setShowProductModal(false);
    await refreshState();
  };

  const handleDeleteProduct = (prod: Product) => {
    setConfirmDeleteTarget({ type: 'PRODUCT', item: prod });
  };

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantTargetProductId || !varAttrName.trim() || !varAttrVal.trim()) {
      toast.error('Variant attribute name and value are required.');
      return;
    }
    const res = await apiRequest('/api/variants', {
      method: 'POST',
      body: JSON.stringify({
        productId: variantTargetProductId,
        attributeName: varAttrName.trim(),
        attributeValue: varAttrVal.trim(),
        additionalPricePaise: rupeesToPaise(Number(varAddRupees || 0)),
      }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Failed to add variant.');
      return;
    }
    toast.success(`Added variant ${varAttrName}: ${varAttrVal}`);
    setVariantTargetProductId(null);
    setVarAttrVal('');
    await refreshState();
  };

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanName('');
    setPlanPriceRupees('1560');
    setPlanFreq('MONTHLY');
    setPlanMinQty('1');
    setPlanFrom('2026-01-01');
    setPlanUntil('2027-12-31');
    setPlanAutoClose('30');
    setPlanAllowEarly(true);
    setPlanAllowPause(true);
    setPlanAllowRenew(true);
    setShowPlanModal(true);
  };

  const openEditPlan = (plan: Plan) => {
    setEditingPlan(plan);
    setPlanName(plan.name);
    setPlanPriceRupees(String(plan.pricePaise / 100));
    setPlanFreq(plan.billingFrequency);
    setPlanMinQty(String(plan.minQuantity));
    setPlanFrom(plan.availableFrom || '2026-01-01');
    setPlanUntil(plan.availableUntil || '2027-12-31');
    setPlanAutoClose(String(plan.autoCloseDays ?? 30));
    setPlanAllowEarly(plan.allowEarlyClosure);
    setPlanAllowPause(plan.allowPause);
    setPlanAllowRenew(plan.allowRenewal);
    setShowPlanModal(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planName.trim()) {
      toast.error('Plan name is required.');
      return;
    }
    const payload = {
      name: planName.trim(),
      pricePaise: rupeesToPaise(Number(planPriceRupees)),
      billingFrequency: planFreq,
      minQuantity: Number(planMinQty || 1),
      availableFrom: planFrom,
      availableUntil: planUntil,
      autoCloseDays: Number(planAutoClose || 30),
      allowEarlyClosure: planAllowEarly,
      allowPause: planAllowPause,
      allowRenewal: planAllowRenew,
    };

    if (editingPlan) {
      const res = await apiRequest(`/api/plans/${editingPlan.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to update plan.');
        return;
      }
      toast.success(`Updated plan "${planName}".`);
    } else {
      const res = await apiRequest('/api/plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to create plan.');
        return;
      }
      toast.success(`Created plan "${planName}".`);
    }
    setShowPlanModal(false);
    await refreshState();
  };

  const handleTogglePlanStatus = async (plan: Plan) => {
    const nextStatus = plan.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await apiRequest(`/api/plans/${plan.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      toast.error(res.error || 'Could not change plan status.');
      return;
    }
    toast.success(`Plan "${plan.name}" is now ${nextStatus}.`);
    await refreshState();
  };

  const handleDeletePlan = (plan: Plan) => {
    setConfirmDeleteTarget({ type: 'PLAN', item: plan });
  };

  const executeConfirmedDelete = async () => {
    if (!confirmDeleteTarget) return;
    if (confirmDeleteTarget.type === 'PRODUCT') {
      const prod = confirmDeleteTarget.item;
      const res = await apiRequest(`/api/products/${prod.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(res.error || 'Failed to delete product.');
        return;
      }
      toast.success(`Deleted product "${prod.name}".`);
    } else {
      const plan = confirmDeleteTarget.item;
      const res = await apiRequest(`/api/plans/${plan.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(res.error || 'Failed to delete plan.');
        return;
      }
      toast.success(`Deleted plan "${plan.name}".`);
    }
    setConfirmDeleteTarget(null);
    await refreshState();
  };

  return (
    <div className="space-y-6">
      {/* Header & Section Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Product Catalog & Recurring Billing Plans
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure software licenses, dynamic variants, add-ons, and recurring billing schedules
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('PRODUCTS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'PRODUCTS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Products & Variants ({dbState.products.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PLANS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'PLANS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Subscription Plans ({dbState.plans.length})
            </button>
          </div>

          {isAdmin && activeTab === 'PRODUCTS' && (
            <button
              type="button"
              onClick={openCreateProduct}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Product</span>
            </button>
          )}

          {isAdmin && activeTab === 'PLANS' && (
            <button
              type="button"
              onClick={openCreatePlan}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Billing Plan</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'PRODUCTS' && (
        <div className="space-y-6">
          {/* Interactive Variant Pricing Calculator Banner */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600">
                  <Calculator className="w-4 h-4" />
                  <span>Live Product Variant Pricing Engine</span>
                </div>
                <p className="text-xs text-slate-600">
                  Select a base product and variant to preview automatic minor-unit (paise) price
                  resolution (e.g., Software Subscription ₹1,000 + Brand: Odoo ₹560 = ₹1,560).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label htmlFor="sim-prod" className="block text-[11px] text-slate-500 mb-1">
                    Product
                  </label>
                  <select
                    id="sim-prod"
                    value={simProduct?.id || ''}
                    onChange={(e) => {
                      setSelectedSimProductId(e.target.value);
                      const firstVar = dbState.productVariants.find(
                        (v) => v.productId === e.target.value
                      );
                      setSelectedSimVariantId(firstVar?.id || '');
                    }}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 font-medium"
                  >
                    {dbState.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Base: {formatINR(p.salesPricePaise)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sim-var" className="block text-[11px] text-slate-500 mb-1">
                    Variant / Add-on
                  </label>
                  <select
                    id="sim-var"
                    value={simVariant?.id || ''}
                    onChange={(e) => setSelectedSimVariantId(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 font-medium"
                  >
                    {simProductVariants.length === 0 ? (
                      <option value="">Standard (No Variant +₹0)</option>
                    ) : (
                      simProductVariants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.attributeName}: {v.attributeValue} (+
                          {formatINR(v.additionalPricePaise)})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="pl-4 border-l border-slate-200">
                  <div className="text-[11px] text-slate-500">Calculated Total Unit Price</div>
                  <div
                    data-testid="variant-calculated-price"
                    className="text-lg font-bold font-mono tabular-nums text-indigo-700"
                  >
                    {formatINR(simTotalPaise)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search products"
                value={prodSearch}
                onChange={(e) => {
                  setProdSearch(e.target.value);
                  setProdPage(1);
                }}
                placeholder="Search products by name, ID, or description..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Filter by product type"
                value={prodTypeFilter}
                onChange={(e) => {
                  setProdTypeFilter(e.target.value);
                  setProdPage(1);
                }}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="ALL">All Product Types</option>
                <option value="SAAS">SaaS Subscription</option>
                <option value="ADDON">Add-on Service</option>
                <option value="LICENSE">Software License</option>
                <option value="SERVICE">Managed Service</option>
              </select>

              <button
                type="button"
                onClick={() => setProdSortAsc(!prodSortAsc)}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                <span>Price {prodSortAsc ? 'Low → High' : 'High → Low'}</span>
              </button>
            </div>
          </div>

          {/* Products Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Product ID · Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4 text-right">Base Sales Price</th>
                    <th className="py-3 px-4 text-right">Cost Price</th>
                    <th className="py-3 px-4">Configured Variants</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {paginatedProducts.map((prod) => {
                    const variants = dbState.productVariants.filter((v) => v.productId === prod.id);
                    return (
                      <tr key={prod.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{prod.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {prod.id} · {prod.status}
                          </div>
                          {prod.description && (
                            <div className="text-[11px] text-slate-500 mt-0.5 max-w-md truncate">
                              {prod.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-600">{prod.productType}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {formatINR(prod.salesPricePaise)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-500">
                          {formatINR(prod.costPricePaise)}
                        </td>
                        <td className="py-3.5 px-4">
                          {variants.length === 0 ? (
                            <span className="text-slate-400">Standard (No variants)</span>
                          ) : (
                            <div className="space-y-1">
                              {variants.map((v) => (
                                <div key={v.id} className="text-[11px] text-slate-700">
                                  <span className="font-medium">
                                    {v.attributeName}: {v.attributeValue}
                                  </span>
                                  <span aria-hidden="true"> · </span>
                                  <span className="font-mono tabular-nums text-indigo-700">
                                    +{formatINR(v.additionalPricePaise)} (Total:{' '}
                                    {formatINR(prod.salesPricePaise + v.additionalPricePaise)})
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setVariantTargetProductId(prod.id)}
                              className="mt-1.5 text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
                            >
                              <Layers className="w-3 h-3" />
                              <span>+ Add Variant</span>
                            </button>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-500">
                          {formatIndianDate(prod.createdAt)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {isAdmin ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Edit ${prod.name}`}
                                onClick={() => openEditProduct(prod)}
                                className="p-1.5 text-slate-600 hover:text-indigo-600 rounded-md hover:bg-slate-100"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${prod.name}`}
                                onClick={() => handleDeleteProduct(prod)}
                                className="p-1.5 text-slate-600 hover:text-red-600 rounded-md hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">Read-only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing {paginatedProducts.length} of {filteredProducts.length} products
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={prodPage <= 1}
                  onClick={() => setProdPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-mono">Page {prodPage}</span>
                <button
                  type="button"
                  disabled={prodPage * pageSize >= filteredProducts.length}
                  onClick={() => setProdPage((p) => p + 1)}
                  className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'PLANS' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search plans"
                value={planSearch}
                onChange={(e) => setPlanSearch(e.target.value)}
                placeholder="Search billing plans by name..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <select
              aria-label="Filter by billing frequency"
              value={planFreqFilter}
              onChange={(e) => setPlanFreqFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="ALL">All Billing Frequencies</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-3 px-4">Plan Name</th>
                    <th className="py-3 px-4">Frequency</th>
                    <th className="py-3 px-4 text-right">Base Price</th>
                    <th className="py-3 px-4">Min Qty · Auto-Close</th>
                    <th className="py-3 px-4">Availability Window</th>
                    <th className="py-3 px-4">Lifecycle Policies</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredPlans.map((plan) => (
                    <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{plan.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{plan.id}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-indigo-700 font-medium">
                        {plan.billingFrequency}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatINR(plan.pricePaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600">
                        Min {plan.minQuantity} · {plan.autoCloseDays ?? 30}d auto-close
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600">
                        {formatIndianDate(plan.availableFrom)} –{' '}
                        {formatIndianDate(plan.availableUntil)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <span>{plan.allowPause ? 'Pause ✓' : 'No Pause'}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{plan.allowRenewal ? 'Renew ✓' : 'No Renew'}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{plan.allowEarlyClosure ? 'Early Close ✓' : 'Locked'}</span>
                      </td>
                      <td className="py-3.5 px-4 font-medium">
                        <span
                          className={
                            plan.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'
                          }
                        >
                          {plan.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isAdmin ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Toggle status for ${plan.name}`}
                              onClick={() => handleTogglePlanStatus(plan)}
                              className="p-1.5 text-slate-600 hover:text-indigo-600 rounded hover:bg-slate-100"
                              title="Activate / Deactivate Plan"
                            >
                              <Power className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit ${plan.name}`}
                              onClick={() => openEditPlan(plan)}
                              className="p-1.5 text-slate-600 hover:text-indigo-600 rounded hover:bg-slate-100"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${plan.name}`}
                              onClick={() => handleDeletePlan(plan)}
                              className="p-1.5 text-slate-600 hover:text-red-600 rounded hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">Read-only</span>
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

      {/* Create / Edit Product Modal */}
      {showProductModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h2 id="product-modal-title" className="text-lg font-bold text-slate-900">
              {editingProduct ? `Edit Product: ${editingProduct.name}` : 'Create New Product'}
            </h2>
            <form onSubmit={handleSaveProduct} className="space-y-3.5">
              <div>
                <label htmlFor="p-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Product Name *
                </label>
                <input
                  id="p-name"
                  type="text"
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="e.g., Enterprise Cloud CRM"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="p-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Product Type
                  </label>
                  <select
                    id="p-type"
                    value={prodType}
                    onChange={(e) => setProdType(e.target.value as ProductType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="SAAS">SAAS</option>
                    <option value="ADDON">ADDON</option>
                    <option value="LICENSE">LICENSE</option>
                    <option value="SERVICE">SERVICE</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="p-sales"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Sales Price (₹) *
                  </label>
                  <input
                    id="p-sales"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={prodSalesRupees}
                    onChange={(e) => setProdSalesRupees(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="p-cost" className="block text-xs font-medium text-slate-700 mb-1">
                    Cost Price (₹)
                  </label>
                  <input
                    id="p-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={prodCostRupees}
                    onChange={(e) => setProdCostRupees(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="p-desc" className="block text-xs font-medium text-slate-700 mb-1">
                  Description & Notes
                </label>
                <textarea
                  id="p-desc"
                  rows={2}
                  value={prodDesc}
                  onChange={(e) => setProdDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {!editingProduct && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-800">
                    Initial Product Variant (Optional)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label
                        htmlFor="pv-attr"
                        className="block text-[11px] text-slate-600 mb-0.5"
                      >
                        Attribute (e.g. Brand)
                      </label>
                      <input
                        id="pv-attr"
                        type="text"
                        value={newVariantAttr}
                        onChange={(e) => setNewVariantAttr(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="pv-val" className="block text-[11px] text-slate-600 mb-0.5">
                        Value (e.g. Odoo)
                      </label>
                      <input
                        id="pv-val"
                        type="text"
                        value={newVariantVal}
                        onChange={(e) => setNewVariantVal(e.target.value)}
                        placeholder="Odoo"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="pv-extra"
                        className="block text-[11px] text-slate-600 mb-0.5"
                      >
                        Additional Price (₹)
                      </label>
                      <input
                        id="pv-extra"
                        type="number"
                        value={newVariantExtraRupees}
                        onChange={(e) => setNewVariantExtraRupees(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
                      />
                    </div>
                  </div>
                  {newVariantVal && (
                    <div className="text-[11px] text-indigo-700 font-mono">
                      Combined Variant Price: ₹
                      {(Number(prodSalesRupees || 0) + Number(newVariantExtraRupees || 0)).toFixed(
                        2
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Variant Modal */}
      {variantTargetProductId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Add Product Variant</h3>
            <form onSubmit={handleAddVariant} className="space-y-3">
              <div>
                <label htmlFor="add-v-attr" className="block text-xs font-medium text-slate-700 mb-1">
                  Attribute Name *
                </label>
                <input
                  id="add-v-attr"
                  type="text"
                  required
                  value={varAttrName}
                  onChange={(e) => setVarAttrName(e.target.value)}
                  placeholder="Brand / Edition"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="add-v-val" className="block text-xs font-medium text-slate-700 mb-1">
                  Attribute Value *
                </label>
                <input
                  id="add-v-val"
                  type="text"
                  required
                  value={varAttrVal}
                  onChange={(e) => setVarAttrVal(e.target.value)}
                  placeholder="Odoo Enterprise"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="add-v-price" className="block text-xs font-medium text-slate-700 mb-1">
                  Additional Price (₹) *
                </label>
                <input
                  id="add-v-price"
                  type="number"
                  required
                  value={varAddRupees}
                  onChange={(e) => setVarAddRupees(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVariantTargetProductId(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Add Variant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Plan Modal */}
      {showPlanModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              {editingPlan ? `Edit Plan: ${editingPlan.name}` : 'Create Subscription Billing Plan'}
            </h2>
            <form onSubmit={handleSavePlan} className="space-y-3.5">
              <div>
                <label htmlFor="pl-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Plan Name *
                </label>
                <input
                  id="pl-name"
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g., Scale Monthly Plan"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="pl-freq" className="block text-xs font-medium text-slate-700 mb-1">
                    Billing Frequency
                  </label>
                  <select
                    id="pl-freq"
                    value={planFreq}
                    onChange={(e) => setPlanFreq(e.target.value as BillingFrequency)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="DAILY">DAILY</option>
                    <option value="WEEKLY">WEEKLY</option>
                    <option value="MONTHLY">MONTHLY</option>
                    <option value="YEARLY">YEARLY</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="pl-price"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Plan Price (₹) *
                  </label>
                  <input
                    id="pl-price"
                    type="number"
                    min="0"
                    required
                    value={planPriceRupees}
                    onChange={(e) => setPlanPriceRupees(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pl-min" className="block text-xs font-medium text-slate-700 mb-1">
                    Min Quantity
                  </label>
                  <input
                    id="pl-min"
                    type="number"
                    min="1"
                    required
                    value={planMinQty}
                    onChange={(e) => setPlanMinQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="pl-from" className="block text-xs font-medium text-slate-700 mb-1">
                    Available From
                  </label>
                  <input
                    id="pl-from"
                    type="date"
                    value={planFrom}
                    onChange={(e) => setPlanFrom(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pl-until"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Available Until
                  </label>
                  <input
                    id="pl-until"
                    type="date"
                    value={planUntil}
                    onChange={(e) => setPlanUntil(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pl-auto" className="block text-xs font-medium text-slate-700 mb-1">
                    Auto-Close (Days)
                  </label>
                  <input
                    id="pl-auto"
                    type="number"
                    min="0"
                    value={planAutoClose}
                    onChange={(e) => setPlanAutoClose(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planAllowPause}
                    onChange={(e) => setPlanAllowPause(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Allow Pause</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planAllowRenew}
                    onChange={(e) => setPlanAllowRenew(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Allow Renewal</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planAllowEarly}
                    onChange={(e) => setPlanAllowEarly(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Early Closure</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  {editingPlan ? 'Save Plan' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDeleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-xl border border-[#e0e2d6] max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-semibold text-[#18251d]">
              Confirm {confirmDeleteTarget.type === 'PRODUCT' ? 'Product' : 'Billing Plan'} Deletion
            </h3>
            <p className="text-xs text-[#4b554c] leading-relaxed">
              Are you sure you want to delete{' '}
              <strong className="text-[#18251d]">{confirmDeleteTarget.item.name}</strong>? This
              action is logged in the administrative audit trail.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTarget(null)}
                className="px-3.5 py-2 text-xs font-semibold text-[#2c382e] bg-[#f6f5ef] hover:bg-[#eceee4] border border-[#cfd2c5] rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeConfirmedDelete}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
