// public/js/chat/settings.js — the chat on/off switch shown in 设置 → 界面插件 (the plugin manager). A native-looking
// set-row toggle (same styling as the interface-plugin switches) controlling sp.pref.chat-enabled; the chat panel hides
// live when it is off. Rendered right after the 界面插件 section by a hook in ui/settings.js.
import { html } from '../ui/components.js';
import { useState } from '../../vendor/hooks.module.js';
import { chatEnabled, setChatEnabled } from './pref.js';
import { LogoutButton } from '../auth/logout.js';

export function ChatPluginSection() {
  const [on, setOn] = useState(chatEnabled());
  const flip = () => { const v = !on; setOn(v); setChatEnabled(v); };
  return html`<section class="set-plugins" aria-label="聊天" data-testid="fork-chat-toggle">
    <div class="set-row" data-plugin="fork-chat">
      <span class="set-row__label">聊天（大厅 / 房间）</span>
      <button type="button" class=${`set-toggle${on ? ' is-on' : ''}`} role="switch" aria-checked=${on ? 'true' : 'false'} aria-label="聊天"
        onClick=${flip}><i></i><span>${on ? '开启' : '关闭'}</span></button>
    </div>
    <p class="set-hint">关闭后隐藏左下角聊天框，只影响这个浏览器；好友窗口不受影响。</p>
    <div class="set-row" data-plugin="fork-account">
      <span class="set-row__label">账号</span>
      <${LogoutButton} />
    </div>
    <p class="set-hint">登出会撤销当前 token 并返回登录页；同账号在别处登录会顶掉本页。</p>
  </section>`;
}
