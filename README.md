# Rally（中文本地化版）

极简 3D 乒乓球游戏 [Rally](https://my-rally-game.vercel.app/) 的静态站点拷贝，界面已中文化。

> ⚠️ 本仓库为原作品的本地化拷贝，版权归原作者所有，仅供学习用途。

## 技术说明

- 纯静态站点（Vite 预构建产物），无需构建步骤。
- 核心 UI 为 Three.js / troika 3D 文字，中文字体在运行时通过 [unicode-font-resolver](https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver) 从 jsdelivr CDN 加载。

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
