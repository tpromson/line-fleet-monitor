import { useCallback, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: boolean) => void
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve })
    })
  }, [])

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && state) {
        state.resolve(false)
        setState(null)
      }
    },
    [state]
  )

  const handleConfirm = useCallback(() => {
    if (state) {
      state.resolve(true)
      setState(null)
    }
  }, [state])

  const dialog = state ? (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description && <DialogDescription>{state.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {state.cancelText ?? 'Cancel'}
          </Button>
          <Button
            variant={state.destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
          >
            {state.confirmText ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null

  return { confirm, dialog }
}
