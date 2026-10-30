import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import { ApiError, api } from '../../../lib/api';
import { useToast } from '../../../components/ui/Toast';

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing';
type Session = { stream?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setInterval>; request?: AbortController; cancelled: boolean };

export function VoiceInputButton({ authenticated, disabled, onLogin, onText, onBusyChange }: {
  authenticated: boolean; disabled: boolean; onLogin: () => void;
  onText: (text: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const session = useRef<Session>();
  const callbacks = useRef({ onText, onBusyChange });
  callbacks.current = { onText, onBusyChange };

  const release = (current: Session) => {
    clearInterval(current.timer);
    current.stream?.getTracks().forEach(track => track.stop());
  };
  const cancel = () => {
    const current = session.current;
    if (current) {
      current.cancelled = true;
      current.request?.abort();
      if (current.recorder?.state === 'recording') current.recorder.stop();
      release(current);
    }
    session.current = undefined;
    setPhase('idle');
    callbacks.current.onBusyChange(false);
  };
  useEffect(() => () => {
    const current = session.current;
    if (current) {
      current.cancelled = true;
      current.request?.abort();
      if (current.recorder?.state === 'recording') current.recorder.stop();
      release(current);
    }
    callbacks.current.onBusyChange(false);
  }, []);
  useEffect(() => { if (!authenticated) cancel(); }, [authenticated]);

  const start = async () => {
    if (session.current || disabled) return;
    if (!authenticated) { onLogin(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('当前浏览器无法录音，请使用支持麦克风的浏览器，并通过 HTTPS 或本机地址访问');
      return;
    }
    const current: Session = { cancelled: false };
    session.current = current;
    setPhase('requesting');
    callbacks.current.onBusyChange(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      current.stream = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('UNSUPPORTED_RECORDER');
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      current.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        if (!event.data.size || current.cancelled) return;
        chunks.push(event.data);
        bytes += event.data.size;
        if (bytes > 10 * 1024 * 1024) { cancel(); toast.error('录音过大，请缩短后重试'); }
      };
      recorder.onerror = () => { if (!current.cancelled) { cancel(); toast.error('录音中断，请重试'); } };
      recorder.onstop = () => {
        release(current);
        if (current.cancelled) return;
        void (async () => {
          setPhase('transcribing');
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || mime });
            if (!blob.size) { toast.warning('未录到声音，请重新录音'); return; }
            current.request = new AbortController();
            const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
            const { text } = await api.audio.transcribe(blob, `recording.${extension}`, AbortSignal.any([current.request.signal, AbortSignal.timeout(125000)]));
            if (current.cancelled) return;
            if (text.trim()) callbacks.current.onText(text.trim());
            else toast.warning('未识别到语音，请重新录音');
          } catch (error) {
            if (!current.cancelled) toast.error(error instanceof ApiError && error.status === 401 ? '登录已过期，请重新登录' : error instanceof ApiError && error.status === 413 ? '录音过大，请缩短后重试' : '语音识别失败，请稍后重新录音');
          } finally {
            if (!current.cancelled) { session.current = undefined; setPhase('idle'); callbacks.current.onBusyChange(false); }
          }
        })();
      };
      recorder.start(1000);
      setSeconds(0);
      setPhase('recording');
      const started = Date.now();
      current.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 60 && recorder.state === 'recording') recorder.stop();
      }, 250);
    } catch (error) {
      release(current);
      if (current.cancelled) return;
      session.current = undefined;
      setPhase('idle');
      callbacks.current.onBusyChange(false);
      const name = error instanceof Error ? error.name : '';
      toast.error(name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器中允许访问麦克风' : name === 'NotFoundError' ? '未找到可用麦克风' : '无法开始录音，请检查麦克风或浏览器支持');
    }
  };
  const label = phase === 'recording' ? '结束录音并转文字' : phase === 'transcribing' ? '正在识别语音' : phase === 'requesting' ? '正在请求麦克风' : '语音输入';
  return <div className="flex items-center gap-1.5">
    {phase !== 'idle' && <span role="status" className="text-xs text-[#b9b9ba]">{phase === 'recording' ? `录音中 ${seconds}s / 60s` : phase === 'transcribing' ? '正在识别…' : '等待麦克风…'}</span>}
    <button type="button" aria-label={label} title={label} aria-pressed={phase === 'recording'}
      disabled={disabled || phase === 'requesting' || phase === 'transcribing'}
      onClick={() => { if (phase === 'recording') { const recorder = session.current?.recorder; if (recorder?.state === 'recording') recorder.stop(); } else void start(); }}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${phase === 'recording' ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'text-[#b9b9ba] hover:bg-white/[0.08] hover:text-white'}`}>
      {phase === 'requesting' || phase === 'transcribing' ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : phase === 'recording' ? <Square className="h-[15px] w-[15px] fill-current" /> : <Mic className="h-[17px] w-[17px]" />}
    </button>
    {phase !== 'idle' && <button type="button" aria-label="取消语音输入" title="取消语音输入" onClick={cancel} className="flex h-7 w-7 items-center justify-center rounded-full text-[#b9b9ba] hover:bg-white/[0.08]"><X className="h-4 w-4" /></button>}
  </div>;
}
