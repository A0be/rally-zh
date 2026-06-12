# Rally（中文本地化版 + 手势控制）

极简 3D 乒乓球游戏 [Rally](https://my-rally-game.vercel.app/) 的静态站点拷贝，界面已中文化，并新增 **MediaPipe 手势控制**。

> ⚠️ 本仓库为原作品的本地化拷贝，版权归原作者所有，仅供学习用途。
>
> 原作者：[@McGreenBeats](https://x.com/McGreenBeats) · 原作品：<https://my-rally-game.vercel.app/>

## 手势控制（新增）

在原游戏基础上叠加了一层非侵入式的手势控制（[`hand-control.js`](hand-control.js)），不改动游戏本体：

- 用 [MediaPipe Hands](https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/) 检测掌心（landmark 9）。
- **摄像头可选**：不授权也能用鼠标正常游玩；左上角「✋ 启用手势控制」开启后用手控制球拍。
- **相对位置控制**：以掌心的移动增量驱动球拍，手小幅移动即可操作，手离开再回来不跳变。
- 支持**前后摄像头切换**，前置自动镜像；左上角带小预览，配色适配游戏暖米主题。
- 通过合成 `pointerType:'touch'` 指针事件驱动球拍，绕过游戏的鼠标指针锁定。

## 技术说明

- 纯静态站点（Vite 预构建产物），无需构建步骤。
- 核心 UI 为 Three.js / troika 3D 文字，中文字体在运行时通过 [unicode-font-resolver](https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver) 从 jsdelivr CDN 加载。
- 手势控制依赖 MediaPipe Hands（jsdelivr CDN 运行时加载）。

## Cloudflare Pages 部署设置

| 配置项 | 值 |
|---|---|
| Framework preset | None |
| Build command | （留空） |
| Build output directory | `/` |

## 本地预览

```bash
python -m http.server 5173
# 打开 http://127.0.0.1:5173/
```

