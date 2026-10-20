import { Button, Field, Input, Textarea } from '../../components/controls';
import { ModalBackdrop, Modal, PanelHeading } from '../../components/containers';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { adminApi } from '@reel/api-client';
import type { AdminUser } from '@reel/contracts';
import { ErrorBox } from '../../components/ui';

export function AdjustmentDialog({ user, close }: { user: AdminUser; close: () => void }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: adminApi.settings });
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () =>
      adminApi.adjust(user.id, { requestId: requestId.current, amount: Number(amount), reason }),
    onSuccess: () => {
      void client.invalidateQueries();
      close();
    },
  });
  const balance = useQuery({
    queryKey: ['adjust-user', user.id],
    queryFn: async () => {
      const result = await adminApi.users(new URLSearchParams({ search: user.email }).toString());
      return result.items.find((item) => item.id === user.id)?.creditAccount;
    },
  });
  return (
    <ModalBackdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !mutation.isPending) close();
      }}
    >
      <Modal role="dialog" aria-modal="true" aria-labelledby="adjust-title">
        <PanelHeading compact>
          <h2 className="text-[15px] font-semibold" id="adjust-title">
            调整积分
          </h2>
          <Button
            variant="icon"
            size="icon"
            aria-label="关闭"
            onClick={close}
            disabled={mutation.isPending}
          >
            <X size={18} />
          </Button>
        </PanelHeading>
        <p className="text-fg-muted">
          {user.name} · {user.email}
        </p>
        <p>
          当前可用：
          {balance.data?.available ??
            user.creditAccount?.available ??
            `未开通（首次开通赠送 ${settings.data?.signupCredits ?? '—'} 积分）`}
          　冻结：
          {balance.data?.frozen ?? user.creditAccount?.frozen ?? 0}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field>
            调整数量
            <Input
              autoFocus
              type="number"
              required
              min={-1000000}
              max={1000000}
              step="1"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                requestId.current = crypto.randomUUID();
              }}
            />
          </Field>
          <small className="text-fg-muted text-[12px]">
            正数增加，负数扣减；冻结积分不可扣减。
          </small>
          <Field>
            调整原因
            <Textarea
              required
              minLength={2}
              maxLength={300}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                requestId.current = crypto.randomUUID();
              }}
              placeholder="填写原因，操作将记录到审计日志"
            />
          </Field>
          <ErrorBox error={mutation.error} />
          <div className="mt-[25px] flex justify-end gap-[10px]">
            <Button type="button" onClick={close} disabled={mutation.isPending}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={
                mutation.isPending ||
                !Number.isInteger(Number(amount)) ||
                Number(amount) === 0 ||
                reason.trim().length < 2
              }
            >
              {mutation.isPending ? '提交中…' : '确认调整'}
            </Button>
          </div>
        </form>
      </Modal>
    </ModalBackdrop>
  );
}
