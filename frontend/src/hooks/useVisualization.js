import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';

const POLL_INTERVAL_MS = 1000; // 1 Hz polling

export function useVisualization() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const timerRef = useRef(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const data = await api.snapshot();
      setSnapshot(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    timerRef.current = setInterval(fetchSnapshot, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchSnapshot]);

  return { snapshot, error, loading, refetch: fetchSnapshot };
}
