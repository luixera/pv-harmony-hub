import { useState, useCallback } from 'react'
import { ReportFilters } from './useReports'

const DEFAULT_FILTERS: ReportFilters = {
  companyId: null,
  concessionaireId: null,
  staffId: null,
  dateFrom: null,
  dateTo: null,
  period: '3m',
}

export function useReportFilters() {
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)

  const setFilter = useCallback((key: keyof ReportFilters, value: string | null) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const clearFilter = useCallback(
    (key: keyof ReportFilters) => {
      setFilters((prev) => ({ ...prev, [key]: null }))
    },
    []
  )

  const clearAll = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
  }, [])

  const setPeriod = useCallback((period: ReportFilters['period']) => {
    setFilters((prev) => ({ ...prev, period }))
  }, [])

  const activeCount = [filters.companyId, filters.concessionaireId, filters.staffId].filter(Boolean).length

  return {
    filters,
    setFilter,
    clearFilter,
    clearAll,
    setPeriod,
    activeCount,
    activeDropdown,
    setActiveDropdown,
  }
}
