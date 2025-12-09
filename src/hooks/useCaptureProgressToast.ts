/**
 * Reusable hook for managing capture progress toast notifications
 */

import { useRef, useCallback } from 'react';
import { toast } from 'sonner';
import type { ChartCaptureProgress } from '@/lib/charts/types';

export interface CaptureProgressToastOptions {
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
}

export interface UseCaptureProgressToastResult {
  showProgress: (progress: ChartCaptureProgress) => void;
  showComplete: (successCount: number, failedCount: number, cancelled?: boolean) => void;
  showError: (message: string) => void;
  dismiss: () => void;
  toastId: React.MutableRefObject<string | number | undefined>;
}

export function useCaptureProgressToast(
  options: CaptureProgressToastOptions = {}
): UseCaptureProgressToastResult {
  const { onPause, onResume, onCancel } = options;
  const toastRef = useRef<string | number>();

  const showProgress = useCallback((progress: ChartCaptureProgress) => {
    const pauseStatus = progress.isPaused ? ' (PAUSED)' : '';
    const message = `Capturing charts${pauseStatus}: Batch ${progress.currentBatch}/${progress.totalBatches} (${progress.currentItem}/${progress.totalItems} items - ${progress.percentComplete}%)`;

    const toastOptions = {
      id: toastRef.current,
      duration: Infinity,
      action: {
        label: progress.isPaused ? '▶ Resume' : '⏸ Pause',
        onClick: () => {
          if (progress.isPaused) {
            onResume?.();
          } else {
            onPause?.();
          }
        },
      },
      cancel: {
        label: '✕ Cancel',
        onClick: () => {
          onCancel?.();
        },
      },
    };

    if (toastRef.current) {
      toast.loading(message, toastOptions);
    } else {
      toastRef.current = toast.loading(message, toastOptions);
    }
  }, [onPause, onResume, onCancel]);

  const showComplete = useCallback((successCount: number, failedCount: number, cancelled = false) => {
    if (toastRef.current) {
      toast.dismiss(toastRef.current);
    }

    if (cancelled) {
      toast.warning(`Chart capture cancelled. ${successCount} charts saved, ${failedCount} failed.`);
    } else if (failedCount > 0) {
      toast.warning(`Chart capture complete with errors. ${successCount} charts saved, ${failedCount} failed.`);
    } else {
      toast.success(`Chart capture complete! ${successCount} charts saved.`);
    }

    toastRef.current = undefined;
  }, []);

  const showError = useCallback((message: string) => {
    if (toastRef.current) {
      toast.dismiss(toastRef.current);
    }
    toast.error(`Chart capture error: ${message}`);
    toastRef.current = undefined;
  }, []);

  const dismiss = useCallback(() => {
    if (toastRef.current) {
      toast.dismiss(toastRef.current);
      toastRef.current = undefined;
    }
  }, []);

  return {
    showProgress,
    showComplete,
    showError,
    dismiss,
    toastId: toastRef,
  };
}
