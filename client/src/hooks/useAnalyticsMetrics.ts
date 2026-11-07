/** Proyecta los contadores de Analytics Core del usuario activo para el Dashboard del Laboratorio 5 (CN-74). */
import { useEffect, useState } from 'react'
import type { AnalyticsCounters, AnalyticsStorageStatus } from '../types/analytics'
import { analyticsStorage, getAnalyticsCounters, getAnalyticsStorageStatus, refreshAnalyticsState } from '../services/analytics'

export interface DashboardMetrics {
  productViews: number
  searches: number
  cartAdditions: number
  completedPurchases: number
}

export type AnalyticsMetricsState =
  | { status: 'no-session' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; metrics: DashboardMetrics; storage: AnalyticsStorageStatus; isEmpty: boolean }

type Snapshot =
  | { owner: string; status: 'ready'; metrics: DashboardMetrics; storage: AnalyticsStorageStatus }
  | { owner: string; status: 'error' }

/** Selecciona las cuatro métricas del laboratorio sin recalcular nada desde el log de eventos. */
export function toDashboardMetrics(counters: AnalyticsCounters): DashboardMetrics {
  return {
    productViews: counters.productViews,
    searches: counters.searches,
    cartAdditions: counters.cartAdds,
    completedPurchases: counters.purchases,
  }
}

function isSafeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

/** Lee contadores acumulados; el estado de storage solo se vuelve a consultar cuando puede haber cambiado. */
function readSnapshot(userId: string, storage?: AnalyticsStorageStatus): Snapshot {
  try {
    const metrics = toDashboardMetrics(getAnalyticsCounters(userId))
    if (!Object.values(metrics).every(isSafeCount)) return { owner: userId, status: 'error' }
    return { owner: userId, status: 'ready', metrics, storage: storage ?? getAnalyticsStorageStatus(userId) }
  } catch {
    return { owner: userId, status: 'error' }
  }
}

/** Mantiene las métricas sincronizadas con Analytics Core y descarta valores de identidades anteriores. */
export function useAnalyticsMetrics(userId: string | undefined): { state: AnalyticsMetricsState; retry: () => void } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (userId === undefined) return
    let cancelled = false
    let storage: AnalyticsStorageStatus | undefined
    const refresh = (recheckStorage: boolean) => {
      if (cancelled) return
      const next = readSnapshot(userId, recheckStorage ? undefined : storage)
      if (next.status === 'ready') storage = next.storage
      setSnapshot(next)
    }
    refresh(true)
    const scopeKey = analyticsStorage.keyPrefix + 'user:' + encodeURIComponent(userId)
    // Eventos de la misma pestaña: Analytics Core ya actualizó su copia en memoria.
    const handleAnalytics = () => refresh(false)
    // Otra pestaña escribió el mismo scope: reconciliar antes de leer.
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== scopeKey) return
      refreshAnalyticsState(userId)
      refresh(true)
    }
    window.addEventListener(analyticsStorage.changedEvent, handleAnalytics)
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      window.removeEventListener(analyticsStorage.changedEvent, handleAnalytics)
      window.removeEventListener('storage', handleStorage)
    }
  }, [userId, attempt])

  const retry = () => setAttempt(value => value + 1)
  if (userId === undefined) return { state: { status: 'no-session' }, retry }
  if (snapshot === null || snapshot.owner !== userId) return { state: { status: 'loading' }, retry }
  if (snapshot.status === 'error') return { state: { status: 'error' }, retry }
  const isEmpty = Object.values(snapshot.metrics).every(value => value === 0)
  return { state: { status: 'ready', metrics: snapshot.metrics, storage: snapshot.storage, isEmpty }, retry }
}
