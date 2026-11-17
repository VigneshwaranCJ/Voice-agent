import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import { useAuth } from './useAuth'

/** Fetch `path` (re-fetches when the selected tenant changes). */
export function useApi<T>(path: string | null) {
  const { tenantId } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      setData(await api<T>(path))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { reload() }, [reload, tenantId])
  return { data, error, loading, reload, setData }
}
