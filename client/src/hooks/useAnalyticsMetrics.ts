/** Proyecta la actividad agregada disponible; se monta dentro del límite ADMIN del Dashboard. */
import { useEffect, useState } from 'react'
import type { AnalyticsAggregateCounters, AnalyticsAggregatePersistence } from '../types/analytics'
import { analyticsStorage, getAggregateAnalyticsSnapshot, isAnalyticsStorageKey } from '../services/analytics'

/** Cuatro KPIs locales que consume la vista ADMIN. */
export interface DashboardMetrics {
  productViews: number
  searches: number
  cartAdditions: number
  completedPurchases: number
}

/** Distingue el estado de la lectura de las advertencias de persistencia que acompañan a cifras disponibles. */
export type AnalyticsMetricsState =
  | { status: 'no-session' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; metrics: DashboardMetrics; persistence: AnalyticsAggregatePersistence; isEmpty: boolean }

/** Vincula el resultado agregado con la identidad que inició la lectura para descartar resultados tras un cambio de sesión. */
type Snapshot =
  | { owner: string; status: 'ready'; metrics: DashboardMetrics; persistence: AnalyticsAggregatePersistence }
  | { owner: string; status: 'error' }

/** Selecciona las cuatro métricas del laboratorio sin recalcular nada desde el log de eventos. */
export function toDashboardMetrics(counters: AnalyticsAggregateCounters): DashboardMetrics {
  return {
    productViews: counters.productViews,
    searches: counters.searches,
    cartAdditions: counters.cartAdds,
    completedPurchases: counters.purchases,
  }
}

/** Comprueba que cada KPI se pueda mostrar como un entero exacto no negativo. */
function isSafeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

/** Lee contadores acumulados y el resultado actual del IO coordinado. */
function readSnapshot(userId: string): Snapshot {
  try {
    const aggregate = getAggregateAnalyticsSnapshot()
    if (aggregate.status === 'error') return { owner: userId, status: 'error' }
    const metrics = toDashboardMetrics(aggregate.counters)
    if (!Object.values(metrics).every(isSafeCount)) return { owner: userId, status: 'error' }
    return { owner: userId, status: 'ready', metrics, persistence: aggregate.persistence }
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
    let queued = false
    /** Publica una lectura nueva mientras siga vigente la suscripción. */
    const refresh = () => {
      if (cancelled) return
      setSnapshot(readSnapshot(userId))
    }
    refresh()
    /** Agrupa notificaciones de una misma ráfaga en una microtask. */
    const scheduleRefresh = () => {
      if (queued || cancelled) return
      queued = true
      queueMicrotask(() => { queued = false; refresh() })
    }
    /** Solicita una lectura tras un cambio del Core en esta pestaña. */
    const handleAnalytics = () => scheduleRefresh()
    // Incluye otros usuarios, Anonymous, migraciones, nuevos scopes y storage.clear().
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && !isAnalyticsStorageKey(event.key)) return
      scheduleRefresh()
    }
    window.addEventListener(analyticsStorage.changedEvent, handleAnalytics)
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      window.removeEventListener(analyticsStorage.changedEvent, handleAnalytics)
      window.removeEventListener('storage', handleStorage)
    }
  }, [userId, attempt])

  /** Reinicia la suscripción y su lectura inicial después de un error. */
  const retry = () => setAttempt(value => value + 1)
  if (userId === undefined) return { state: { status: 'no-session' }, retry }
  if (snapshot === null || snapshot.owner !== userId) return { state: { status: 'loading' }, retry }
  if (snapshot.status === 'error') return { state: { status: 'error' }, retry }
  const isEmpty = Object.values(snapshot.metrics).every(value => value === 0)
  return { state: { status: 'ready', metrics: snapshot.metrics, persistence: snapshot.persistence, isEmpty }, retry }
}
