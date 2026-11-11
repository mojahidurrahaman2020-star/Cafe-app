import { useQuery } from '@tanstack/react-query';
import type {
  CategoryAvailabilityDTO,
  IngredientDTO,
  MenuCategoryDTO,
  ProductDTO,
  StockMovementDTO,
  SupplierDTO,
} from '@bitebrew/shared';
import { get } from '../api/client';

export const useCategories = (includeInactive = true) =>
  useQuery({
    queryKey: ['categories', { includeInactive }],
    queryFn: async () => (await get<{ categories: MenuCategoryDTO[] }>(`/categories${includeInactive ? '?includeInactive=true' : ''}`)).categories,
  });

export const useProducts = (includeInactive = true) =>
  useQuery({
    queryKey: ['products', { includeInactive }],
    queryFn: async () => (await get<{ products: ProductDTO[] }>(`/products${includeInactive ? '?includeInactive=true' : ''}`)).products,
  });

export const useIngredients = (includeInactive = false, enabled = true) =>
  useQuery({
    queryKey: ['ingredients', { includeInactive }],
    queryFn: async () => (await get<{ ingredients: IngredientDTO[] }>(`/ingredients${includeInactive ? '?includeInactive=true' : ''}`)).ingredients,
    enabled,
  });

export const useSuppliers = (enabled = true) =>
  useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await get<{ suppliers: SupplierDTO[] }>('/suppliers')).suppliers,
    enabled,
  });

export const useAvailability = () =>
  useQuery({
    queryKey: ['availability'],
    queryFn: async () => (await get<{ categories: CategoryAvailabilityDTO[] }>('/availability')).categories,
    refetchInterval: 60_000,
  });

export const useMovements = (params: { kind?: 'INGREDIENT' | 'FINISHED'; itemId?: string; limit?: number }) => {
  const qs = new URLSearchParams();
  if (params.kind) qs.set('kind', params.kind);
  if (params.itemId) qs.set('itemId', params.itemId);
  qs.set('limit', String(params.limit ?? 50));
  return useQuery({
    queryKey: ['movements', params],
    queryFn: async () => (await get<{ movements: StockMovementDTO[] }>(`/stock/movements?${qs}`)).movements,
  });
};

/** Query keys refreshed after any stock change. */
export const STOCK_KEYS = [['ingredients'], ['products'], ['availability'], ['movements'], ['batches'], ['dashboard'], ['product']] as const;

// ─────────── POS / finance ───────────
import type { CashSessionDTO, OrderDTO, PaymentMethodDTO, PrinterDTO, PrintJobDTO, TaxRateDTO } from '@bitebrew/shared';

export const usePaymentMethods = () =>
  useQuery({ queryKey: ['payment-methods'], queryFn: async () => (await get<{ paymentMethods: PaymentMethodDTO[] }>('/payment-methods')).paymentMethods, staleTime: 5 * 60_000 });
export const useTaxRates = () =>
  useQuery({ queryKey: ['tax-rates'], queryFn: async () => (await get<{ taxRates: TaxRateDTO[] }>('/tax-rates')).taxRates, staleTime: 5 * 60_000 });
export const useOrders = (params: { date?: string; status?: string; needsReview?: boolean }, enabled = true) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set('date', params.date);
  if (params.status) qs.set('status', params.status);
  if (params.needsReview) qs.set('needsReview', 'true');
  return useQuery({ queryKey: ['orders', params], queryFn: async () => (await get<{ orders: OrderDTO[]; businessDate: string | null }>(`/orders?${qs}`)), enabled });
};
export const useCashSession = () =>
  useQuery({ queryKey: ['cash'], queryFn: async () => (await get<{ session: CashSessionDTO | null }>('/cash/current')).session });
export const usePrinters = () =>
  useQuery({ queryKey: ['printers'], queryFn: async () => (await get<{ printers: PrinterDTO[] }>('/printers')).printers, refetchInterval: 30_000 });
export const usePrintJobs = (params: { status?: string; orderId?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams({ limit: String(params.limit ?? 50) });
  if (params.status) qs.set('status', params.status);
  if (params.orderId) qs.set('orderId', params.orderId);
  return useQuery({ queryKey: ['print-jobs', params], queryFn: async () => (await get<{ jobs: PrintJobDTO[] }>(`/print-jobs?${qs}`)).jobs });
};
