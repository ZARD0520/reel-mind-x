import { Input, Button, Select } from '../components/controls';
import { Panel, Toolbar, SearchForm, PanelHeading, ModalBackdrop, Modal } from '../components/containers';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Film, Image, Music, Search, X } from 'lucide-react';
import type { AdminAssetRow } from '@reel/contracts';
import { adminApi } from '@reel/api-client';
import { Badge, Empty, ErrorBox, Pagination, Table } from '../components/ui';
import { adminListQuery, kindName, sourceName, statusName, time } from '../lib/display';

const kindIcons: Record<string, typeof Film> = {
  video: Film,
  image: Image,
  audio: Music,
  text: FileText,
};

const thumbClass = 'block h-[40px] w-[54px] object-cover';

function Thumb({ asset, onPreview }: { asset: AdminAssetRow; onPreview: () => void }) {
  const [failed, setFailed] = useState(false);
  const Icon = kindIcons[asset.kind] ?? FileText;
  return (
    <button
      type="button"
      aria-label={`预览素材：${asset.name}`}
      title="点击预览"
      onClick={onPreview}
      className="shrink-0 cursor-pointer overflow-hidden rounded-[5px] border border-border hover:border-[#555465]"
    >
      {!failed && asset.url && (asset.kind === 'image' || asset.kind === 'video') ? (
        asset.kind === 'image' ? (
          <img
            src={asset.url}
            alt=""
            loading="lazy"
            className={thumbClass}
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            src={asset.url}
            muted
            preload="metadata"
            className={thumbClass}
            onError={() => setFailed(true)}
          />
        )
      ) : (
        <span className="grid h-[40px] w-[54px] place-items-center bg-[#202027] text-[#8a7fc0]">
          <Icon size={17} />
        </span>
      )}
    </button>
  );
}

function PreviewContent({ asset, content }: { asset: AdminAssetRow; content?: string | null }) {
  const Icon = kindIcons[asset.kind] ?? FileText;
  if (asset.kind === 'text')
    return (
      <div className="max-h-[60vh] w-full overflow-auto whitespace-pre-wrap p-[20px] text-left text-[13px] leading-[1.8] text-[#c9c9d4]">
        {content || '暂无内容'}
      </div>
    );
  if (!asset.url)
    return (
      <div className="flex w-full flex-col items-center gap-[12px] p-[40px] text-[#92929f]">
        <Icon size={36} />
        <span className="text-[12px]">素材尚未就绪</span>
      </div>
    );
  if (asset.kind === 'image')
    return <img src={asset.url} alt={asset.name} className="max-h-[60vh] w-full object-contain" />;
  if (asset.kind === 'video')
    return <video src={asset.url} controls className="max-h-[60vh] w-full" />;
  return (
    <div className="flex w-full flex-col items-center gap-[18px] p-[36px]">
      <Music size={36} className="text-[#8a7fc0]" />
      <audio src={asset.url} controls className="w-full" aria-label={asset.name} />
    </div>
  );
}

function AssetPreviewDialog({ asset, close }: { asset: AdminAssetRow; close: () => void }) {
  // 媒体素材直接用列表里的 url 预览；文本内容需要请求详情
  const detail = useQuery({
    queryKey: ['admin-asset', asset.id],
    queryFn: () => adminApi.asset(asset.id),
    enabled: asset.kind === 'text',
  });
  return (
    <ModalBackdrop>
      <Modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-preview-title"
        className="w-[720px] max-[760px]:w-full"
      >
        <PanelHeading compact>
          <h2 className="text-[15px] font-semibold" id="asset-preview-title">
            {asset.name}
          </h2>
          <Button aria-label="关闭" onClick={close}>
            <X size={18} />
          </Button>
        </PanelHeading>
        <div className="flex items-center justify-center overflow-hidden rounded-[7px] border border-border bg-[#131318]">
          {asset.kind === 'text' && detail.isPending ? (
            <div className="p-[40px] text-[12px] text-[#92929f]">加载中…</div>
          ) : (
            <PreviewContent asset={asset} content={detail.data?.content} />
          )}
        </div>
        <ErrorBox error={detail.error} />
      </Modal>
    </ModalBackdrop>
  );
}

const emptyFilters = { search: '', start: '', end: '', kind: '', status: '' };

export function AssetsPage() {
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [preview, setPreview] = useState<AdminAssetRow | null>(null);
  const query = useQuery({
    queryKey: ['admin-assets', page, filters],
    queryFn: () => adminApi.assets(adminListQuery(page, filters)),
  });
  const reset = () => {
    setText('');
    setFilters(emptyFilters);
    setPage(1);
  };
  return (
    <Panel>
      <Toolbar>
        <SearchForm
          className="w-full flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setFilters((current) => ({ ...current, search: text.trim() }));
          }}
        >
          <Search size={17} className="shrink-0" />
          <div className="flex min-w-[200px] flex-1">
            <Input
              aria-label="用户名称"
              placeholder="用户昵称"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Input
            compact
            aria-label="创建时间起"
            type="date"
            className="shrink-0"
            value={filters.start}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({ ...current, start: event.target.value }));
            }}
          />
          <span className="shrink-0 text-[#71717f]">—</span>
          <Input
            compact
            aria-label="创建时间止"
            type="date"
            className="shrink-0"
            value={filters.end}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({ ...current, end: event.target.value }));
            }}
          />
          <Select
            className="w-[110px] shrink-0"
            aria-label="素材类型"
            value={filters.kind}
            onChange={(value) => {
              setPage(1);
              setFilters((current) => ({ ...current, kind: value }));
            }}
            options={[
              { value: '', label: '全部类型' },
              ...['video', 'image', 'audio', 'text'].map((value) => ({
                value,
                label: kindName[value] ?? value,
              })),
            ]}
          />
          <Select
            className="w-[110px] shrink-0"
            aria-label="素材状态"
            value={filters.status}
            onChange={(value) => {
              setPage(1);
              setFilters((current) => ({ ...current, status: value }));
            }}
            options={[
              { value: '', label: '全部状态' },
              ...['ready', 'generating'].map((value) => ({
                value,
                label: statusName[value] ?? value,
              })),
            ]}
          />
          <div className="flex w-full justify-end gap-[8px]">
            <Button>查询</Button>
            <Button type="button" onClick={reset}>
              重置
            </Button>
          </div>
        </SearchForm>
      </Toolbar>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Empty>加载中…</Empty>
      ) : query.data?.items.length ? (
        <Table
          headings={['素材', '类型', '来源', '状态', '所属用户', '所在文件夹', '规格', '模型', '创建时间']}
        >
          {query.data.items.map((asset) => (
            <tr key={asset.id}>
              <td>
                <div className="flex items-center gap-[10px]">
                  <Thumb asset={asset} onPreview={() => setPreview(asset)} />
                  <div className="min-w-0">
                    <div className="max-w-[260px] truncate font-medium text-[#f0f0f4]">
                      {asset.name}
                    </div>
                    {asset.prompt && (
                      <small className="max-w-[260px] truncate text-fg-muted">{asset.prompt}</small>
                    )}
                  </div>
                </div>
              </td>
              <td>{kindName[asset.kind] ?? asset.kind}</td>
              <td>{sourceName[asset.source] ?? asset.source}</td>
              <td>
                <Badge status={asset.status} />
                {asset.error && (
                  <small className="max-w-[180px] truncate text-[#efa1a8]">{asset.error}</small>
                )}
              </td>
              <td>
                {asset.user.name}
                <small className="text-fg-muted text-[12px]">{asset.user.email}</small>
              </td>
              <td>{asset.folderName ?? '—'}</td>
              <td>{asset.width && asset.height ? `${asset.width}×${asset.height}` : '—'}</td>
              <td>{asset.model ?? '—'}</td>
              <td>{time(asset.createdAt)}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty />
      )}
      <Pagination data={query.data} page={page} setPage={setPage} />
      {preview && <AssetPreviewDialog asset={preview} close={() => setPreview(null)} />}
    </Panel>
  );
}
