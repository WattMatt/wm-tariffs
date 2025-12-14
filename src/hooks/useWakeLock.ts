import { useState, useCallback, useRef } from 'react';

export function useWakeLock() {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const request = useCallback(async () => {
    if (!isSupported) {
      console.log('Wake Lock API not supported in this browser');
      return false;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock!.request('screen');
      setIsLocked(true);
      
      wakeLockRef.current.addEventListener('release', () => {
        setIsLocked(false);
      });
      
      console.log('Screen Wake Lock: acquired');
      return true;
    } catch (err) {
      console.error('Wake Lock request failed:', err);
      return false;
    }
  }, [isSupported]);

  const release = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setIsLocked(false);
        console.log('Screen Wake Lock: released');
      } catch (err) {
        console.error('Wake Lock release failed:', err);
      }
    }
  }, []);

  return { isSupported, isLocked, request, release };
}
