import { useCallback, useState } from 'react'

export function useConfirmAction<T>(onConfirmAction: (item: T) => void) {
  const [pendingItem, setPendingItem] = useState<T | null>(null)

  const requestConfirm = useCallback((item: T) => {
    setPendingItem(item)
  }, [])

  const cancelConfirm = useCallback(() => {
    setPendingItem(null)
  }, [])

  const confirm = useCallback(() => {
    if (pendingItem === null) return
    onConfirmAction(pendingItem)
    setPendingItem(null)
  }, [pendingItem, onConfirmAction])

  return {
    pendingItem,
    isOpen: pendingItem !== null,
    requestConfirm,
    cancelConfirm,
    confirm,
  }
}
