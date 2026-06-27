import { useEffect, useState } from 'react';

/**
 * 浏览器自动播放策略要求首次调用 audio.play() 必须在用户手势的调用栈内，
 * 否则抛 NotAllowedError（且被静默 catch 后就表现为"没声音、没报错"）。
 *
 * 用法：
 * 1. 在根组件调用 `const unlocked = useAudioUnlock()` 建立手势监听；
 * 2. 传给 AudioMixer / AudioVoice；
 * 3. AudioVoice 的 play() 调用前先检查 unlocked，避免过早调用被拒。
 *
 * 原理：用户首次点击/按键时，立即创建一个 dummy <audio> 并 play()（可在手势
 * 调用栈里成功），这会向浏览器证明"用户同意了播放"，后续异步调用也放行。
 */
export function useAudioUnlock(): boolean {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (unlocked) return; // already unlocked

    const unlock = () => {
      // 用一个空 audio 占用手势权限，证明用户允许播放。
      // 这个 dummy 元素会被立即销毁，真实音频仍用独立的 <audio> 元素。
      const dummy = document.createElement('audio');
      dummy.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; // 空 wav
      dummy.volume = 0; // 静音避免出声
      void dummy
        .play()
        .then(() => {
          console.log('[AudioUnlock] 已激活音频播放权限');
          setUnlocked(true);
          dummy.remove();
        })
        .catch(() => {
          // 仍被拒（极少见；可能是用户设置了硬限制），降级静默运行。
          console.warn('[AudioUnlock] 浏览器拒绝自动播放，音频将保持静音');
          setUnlocked(true); // 仍标记为 unlocked 避免无限等待
          dummy.remove();
        });
    };

    // 监听任意交互（点击、触摸、键盘），首次触发即解锁。
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => document.addEventListener(e, unlock, { once: true, capture: true }));

    return () => {
      events.forEach((e) => document.removeEventListener(e, unlock, { capture: true }));
    };
  }, [unlocked]);

  return unlocked;
}
