import { Button, Field, Input, Select } from '../components/controls';
import { Panel, PanelHeading, ModalBackdrop, Modal } from '../components/containers';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { CreditPriceRecord } from '@reel/contracts';
import { adminApi } from '@reel/api-client';
import { Badge, Empty, ErrorBox, Table } from '../components/ui';
import { kindName, time } from '../lib/display';

export function PricingPage() {
  const client = useQueryClient();
  const prices = useQuery({ queryKey: ['prices'], queryFn: adminApi.prices });
  const settings = useQuery({ queryKey: ['settings'], queryFn: adminApi.settings });
  const [editing, setEditing] = useState<Partial<CreditPriceRecord> | null>(null);
  const [signup, setSignup] = useState<string | null>(null);
  const [daily, setDaily] = useState<string | null>(null);
  const [concurrent, setConcurrent] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (
      input: Pick<CreditPriceRecord, 'kind' | 'model' | 'unit' | 'credits' | 'enabled'>,
    ) => adminApi.savePrice(input),
    onSuccess: () => {
      setEditing(null);
      void client.invalidateQueries({ queryKey: ['prices'] });
    },
  });
  const trial = useMutation({
    mutationFn: () =>
      adminApi.saveSettings({
        signupCredits: Number(signup ?? settings.data?.signupCredits ?? 100),
        dailyCredits: Number(daily ?? settings.data?.dailyCredits ?? 10000),
        maxConcurrent: Number(concurrent ?? settings.data?.maxConcurrent ?? 3),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save.mutate({
      kind: data.get('kind') as CreditPriceRecord['kind'],
      model: String(data.get('model')),
      unit: data.get('unit') as 'request' | 'second',
      credits: Number(data.get('credits')),
      enabled: data.get('enabled') === 'on',
    });
  }
  return (
    <>
      <Panel>
        <PanelHeading>
          <div>
            <h2 className="text-[15px] font-semibold">模型积分规则</h2>
            <p>精确模型规则优先；* 规则覆盖该类型的其他模型。改价仅影响新任务。</p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              save.reset();
              setEditing({ kind: 'image', model: '', unit: 'request', credits: 10, enabled: true });
            }}
          >
            新增规则
          </Button>
        </PanelHeading>
        <ErrorBox error={prices.error} />
        {prices.isPending ? (
          <Empty>加载中…</Empty>
        ) : (
          <Table headings={['类型', '模型', '消耗', '状态', '版本', '更新时间', '操作']}>
            {prices.data?.map((price) => (
              <tr key={price.id}>
                <td>{kindName[price.kind]}</td>
                <td className="font-medium text-[#f0f0f4]">
                  {price.model === '*' ? '*（默认规则）' : price.model}
                </td>
                <td>
                  {price.credits} 积分 / {price.unit === 'second' ? '秒' : '次'}
                </td>
                <td>
                  <Badge status={price.enabled ? 'active' : 'disabled'} />
                </td>
                <td>v{price.version}</td>
                <td>{time(price.updatedAt)}</td>
                <td>
                  <Button
                    onClick={() => {
                      save.reset();
                      setEditing(price);
                    }}
                  >
                    编辑规则
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel className="flex flex-wrap items-center gap-[25px] p-[23px] max-[760px]:p-[18px] [&>div:first-child]:flex-1 [&_p]:mt-[9px] [&_p]:text-[12px] [&_p]:leading-[1.7] [&_form]:flex [&_form]:flex-wrap [&_form]:items-end [&_form]:gap-[10px]">
        <div>
          <h2 className="text-[15px] font-semibold">试用额度与使用上限</h2>
          <p className="text-fg-muted">
            首次开通账户时赠送试用积分。每日额度按 UTC 自然日统计，设为 0 表示不限制。
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            trial.mutate();
          }}
        >
          <Field variant="setting">
            试用积分
            <Input
              compact
              aria-label="试用积分"
              type="number"
              required
              min={0}
              max={1000000}
              step="1"
              value={signup ?? settings.data?.signupCredits ?? ''}
              onChange={(event) => setSignup(event.target.value)}
            />
          </Field>
          <Field variant="setting">
            每日消耗上限
            <Input
              compact
              aria-label="每日消耗上限"
              type="number"
              min={0}
              max={10000000}
              step="1"
              required
              value={daily ?? settings.data?.dailyCredits ?? 10000}
              onChange={(event) => setDaily(event.target.value)}
            />
          </Field>
          <Field variant="setting">
            同时处理任务上限
            <Input
              compact
              aria-label="同时处理任务上限"
              type="number"
              min={1}
              max={100}
              step="1"
              required
              value={concurrent ?? settings.data?.maxConcurrent ?? 3}
              onChange={(event) => setConcurrent(event.target.value)}
            />
          </Field>
          <Button variant="primary" disabled={trial.isPending || settings.isPending}>
            保存
          </Button>
        </form>
        <ErrorBox error={settings.error ?? trial.error} />
        {trial.isSuccess && (
          <span role="status" className="text-positive">
            已保存
          </span>
        )}
      </Panel>
      {editing && (
        <ModalBackdrop>
          <Modal role="dialog" aria-modal="true" aria-labelledby="price-title">
            <PanelHeading compact>
              <h2 className="text-[15px] font-semibold" id="price-title">
                {editing.id ? '编辑' : '新增'}定价规则
              </h2>
              <Button aria-label="关闭" onClick={() => setEditing(null)} disabled={save.isPending}>
                <X size={18} />
              </Button>
            </PanelHeading>
            <form onSubmit={submit}>
              <Field>
                类型
                <Select
                  name="kind"
                  value={editing.kind}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      kind: event.target.value as CreditPriceRecord['kind'],
                      unit: 'request',
                    })
                  }
                  disabled={!!editing.id}
                >
                  {Object.entries(kindName).map(([value, title]) => (
                    <option key={value} value={value}>
                      {title}
                    </option>
                  ))}
                </Select>
                {editing.id && <Input type="hidden" name="kind" value={editing.kind} />}
              </Field>
              <Field>
                模型标识
                <Input
                  name="model"
                  required
                  maxLength={100}
                  placeholder="模型 ID 或 *"
                  defaultValue={editing.model}
                  readOnly={!!editing.id}
                />
              </Field>
              <Field>
                计费单位
                <Select name="unit" defaultValue={editing.unit}>
                  <option value="request">每次生成</option>
                  {editing.kind === 'video' && <option value="second">每秒视频</option>}
                </Select>
              </Field>
              <Field>
                积分
                <Input
                  type="number"
                  name="credits"
                  required
                  min={0}
                  max={100000}
                  step="1"
                  defaultValue={editing.credits}
                />
              </Field>
              <Field variant="checkbox">
                <Input name="enabled" type="checkbox" defaultChecked={editing.enabled} />
                开放生成
              </Field>
              <ErrorBox error={save.error} />
              <div className="mt-[25px] flex justify-end gap-[10px]">
                <Button type="button" onClick={() => setEditing(null)} disabled={save.isPending}>
                  取消
                </Button>
                <Button variant="primary" disabled={save.isPending}>
                  保存规则
                </Button>
              </div>
            </form>
          </Modal>
        </ModalBackdrop>
      )}
    </>
  );
}
