import { useState, useMemo, useEffect, useCallback } from 'react';
import { Order } from '../../master-data/data';

type OrderSortConfig = { key: 'price', direction: 'asc' | 'desc' };
export type OrderPriceSortDirection = OrderSortConfig['direction'] | null;

const normalizePrice = (value: Order['price']) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

interface UseOrderPaginationParams {
  filteredOrders: Order[];
  filteredOrdersBase: Order[];
  statusFilter: string;
  cancelReasonFilter: string;
}

export function useOrderPagination({
  filteredOrders,
  filteredOrdersBase,
  statusFilter,
  cancelReasonFilter,
}: UseOrderPaginationParams) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<OrderSortConfig | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [filteredOrdersBase, statusFilter, cancelReasonFilter]);

  const requestSort = useCallback((key: string) => {
    setCurrentPage(1);
    setSortConfig(prev => {
      if (key !== 'price') {
        return prev;
      }

      const firstDirection: OrderSortConfig['direction'] = 'desc';
      if (!prev || prev.key !== key) {
        return { key, direction: firstDirection };
      }

      return { key, direction: prev.direction === 'desc' ? 'asc' : 'desc' };
    });
  }, []);

  const setPriceSortDirection = useCallback((direction: OrderPriceSortDirection) => {
    setCurrentPage(1);
    setSortConfig(direction ? { key: 'price', direction } : null);
  }, []);

  // Sorting
  const sortedOrders = useMemo(() => {
    if (sortConfig?.key !== 'price') {
      return filteredOrders;
    }

    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;
    return filteredOrders
      .map((order, index) => ({
        order,
        index,
        price: normalizePrice(order.price),
      }))
      .sort((a, b) => {
        const priceDelta = a.price - b.price;
        return (priceDelta * directionMultiplier) || a.index - b.index;
      })
      .map(({ order }) => order);
  }, [filteredOrders, sortConfig]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedOrders.slice(start, start + itemsPerPage);
  }, [sortedOrders, currentPage, itemsPerPage]);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(paginatedOrders.map(o => o.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [paginatedOrders]);

  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const newSelected = new Set(prev);
      if (checked) newSelected.add(id);
      else newSelected.delete(id);
      return newSelected;
    });
  }, []);

  return {
    currentPage, setCurrentPage,
    itemsPerPage, setItemsPerPage,
    selectedIds, setSelectedIds,
    sortConfig,
    requestSort,
    setPriceSortDirection,
    sortedOrders,
    totalPages,
    paginatedOrders,
    handleSelectAll,
    handleSelectRow,
  };
}
