/**
 * useVisualization.js — AETHER ACM v2
 *
 * Primary:  WebSocket push stream (useWebSocket) — sub-second latency.
 * Fallback: HTTP polling at 1 Hz — activates if WS is not connected after
 *           FALLBACK_DELAY_MS.
 *
 * Returned snapshot is always the freshest data regardless of transport.
 * `wsConnected` lets downstream components show the connection badge.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { api } from '../lib/api';

const POLL_INTERVAL_MS  = 1000;   // HTTP fallback poll rate
const FALLBACK_DELAY_MS = 3000;   // Wait this long for WS before starting poll

export function useVisualization() {
  const { snapshot: wsSnapshot, connected: wsConnected, error: wsError } = useWebSocket();

  // HTTP fallback state
  const [httpSnapshot, setHttpSnapshot] = useState(null);
  const [httpError,    setHttpError]    = useState(null);
  const [httpLoading,  setHttpLoading]  = useState(true);
  const pollRef   = useRef(null);
  const startedRef = useRef(false);

  const fetchHttp = useCallback(async () => {
    try {
      const data = await api.snapshot();
      setHttpSnapshot(data);
      setHttpError(null);
    } catch (e) {
      setHttpError(e.message);
    } finally {
      setHttpLoading(false);
    }
  }, []);

  // Start HTTP polling only if WS fails to connect within FALLBACK_DELAY_MS
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!wsConnected && !startedRef.current) {
        startedRef.current = true;
        fetchHttp();
        pollRef.current = setInterval(fetchHttp, POLL_INTERVAL_MS);
      }
    }, FALLBACK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [wsConnected, fetchHttp]);

  // If WS later connects, stop the HTTP poll
  useEffect(() => {
    if (wsConnected && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      startedRef.current = false;
    }
  }, [wsConnected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  // Compose the best available data
  const snapshot = wsSnapshot ?? httpSnapshot;
  const error    = wsConnected ? null : (httpError ?? wsError);
  const loading  = !snapshot;

  return { snapshot, error, loading, wsConnected };
}
