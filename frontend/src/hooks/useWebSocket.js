/**
 * useWebSocket.js — AETHER ACM
 *
 * Custom hook that maintains a WebSocket connection to the backend push stream.
 *
 *   ws://localhost:8000/api/ws/snapshot
 *
 * Behaviour:
 *   - Connects on mount, reconnects on close/error (exponential back-off, max 30 s)
 *   - Every incoming message replaces `snapshot` state
 *   - `connected` flag is true only while the socket is OPEN
 *   - Cleanup: closes socket on component unmount
 *   - Falls back gracefully if WS is unavailable (returns connected=false; caller
 *     can detect this and switch to HTTP polling via useVisualization)
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const BASE_WS = (() => {
  // Production: wss://aether-acm-backend.onrender.com
  // Development: ws://localhost:8000
  const base = import.meta.env.VITE_API_BASE ?? 'https://aether-acm-backend.onrender.com';
  // Convert http:// → ws://, https:// → wss://
  return base.replace(/^http/, 'ws');
})();

const WS_URL = `${BASE_WS}/api/ws/snapshot`;

// Reconnect timing: 1 s, 2 s, 4 s … capped at 30 s
const BACKOFF_BASE_MS  = 1000;
const BACKOFF_MAX_MS   = 30000;

export function useWebSocket() {
  const [snapshot,  setSnapshot]  = useState(null);
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState(null);

  const wsRef       = useRef(null);
  const retryRef    = useRef(0);          // attempt count
  const timerRef    = useRef(null);       // reconnect timer
  const mountedRef  = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
        setError(null);
        retryRef.current = 0;             // reset back-off
      };

      ws.onmessage = (evt) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(evt.data);
          setSnapshot(data);
        } catch (e) {
          // Malformed JSON — ignore, keep connection
        }
      };

      ws.onerror = () => {
        setError('WebSocket error — falling back to HTTP polling');
        setConnected(false);
      };

      ws.onclose = (evt) => {
        if (!mountedRef.current) return;
        setConnected(false);
        if (evt.code === 1000) return;  // Clean close — don't reconnect

        // Exponential back-off reconnect
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, retryRef.current),
          BACKOFF_MAX_MS
        );
        retryRef.current += 1;
        timerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };
    } catch (err) {
      // WS constructor can throw in non-browser environments
      setError(`WebSocket unavailable: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'component unmount');
      }
    };
  }, [connect]);

  return { snapshot, connected, error };
}
