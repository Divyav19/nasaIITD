import { useState, useCallback } from 'react';
import { api } from '../lib/api';

export function useSimulation() {
  const [stepping, setStepping] = useState(false);
  const [lastStepResult, setLastStepResult] = useState(null);
  const [stepSeconds, setStepSeconds] = useState(3600);

  const step = useCallback(async (seconds) => {
    const secs = seconds ?? stepSeconds;
    setStepping(true);
    try {
      const result = await api.step(secs);
      setLastStepResult(result);
      return result;
    } finally {
      setStepping(false);
    }
  }, [stepSeconds]);

  return { step, stepping, lastStepResult, stepSeconds, setStepSeconds };
}
