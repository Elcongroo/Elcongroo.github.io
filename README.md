# congroo 的个人博客

congroo 的个人技术笔记。Astro 7 + TypeScript + Markdown/MDX；浏览器只加载主题切换和按需全文搜索所需的小段逻辑，不使用数据库或应用后端。

当前最小版本：以标题、摘要、要点与依据组成的文章首页、全文搜索目录、个人简介、主题与时间归档、文章目录、4 篇文章、1 条真实实验日志、About、深色模式、Pagefind 全文搜索、RSS 和站点地图。原有文章与主题地址保留。完整项目、源码地图、学习路径和性能实验页属于下一阶段，尚未实现。

- [写作与更新指南](docs/写作与更新指南.md)：内容模型、状态、来源和组件。
- [文章模板](docs/文章模板.md)：新文章的元数据与正文结构。

## 开发与构建

使用 Node.js 22.19+，建议 Node 24 和随附的新版本 npm。GitHub 工作流采用 Node 24。以下命令在本项目目录依次执行，不需要管理员权限：

```bash
npm ci
npm run check
npm run build
npm run check:output
npm run preview
```

`npm ci` 按锁文件安装依赖；`check` 做类型与内容检查；`build` 先生成静态页面再构建全文索引；`check:output` 检查本地引用与关键输出；`preview` 提供构建产物的本地地址。开发时使用 `npm run dev`，检验搜索用完成构建后的 `preview`。

运行目录错误会找不到 package.json；安装失败先检查 Node/npm 版本与网络；构建失败不得将旧 dist 当作新版本。当前 Astro 的 dev 命令可能启动后台进程，结束可用 `npx astro dev stop`；preview 在前台时用 Ctrl+C 停止。

## 目录与发布边界

```text
src/content/posts/   文章，Markdown 或 MDX
src/content/lab/     实验台账，Markdown
src/pages/index.astro 首页与手动维护的个人简介
src/components/     状态标签、搜索与技术内容块
public/downloads/   独立示例脚本、原始输出和校验值
scripts/             Markdown基址处理与产物检查
.github/workflows/  GitHub Pages自动发布
```

文章不是公司知识库镜像。LAB-001 的代码由 Codex 编写并真实运行，作者本人复现尚未完成。VERIFIED 只覆盖对应原始记录中的用例。

`draft: true` 从页面、RSS和搜索索引排除，但源码仍包含原文。私有内容不能靠 draft 字段获得保护，不要将它放进公开仓库。

`PUBLIC_SITE=true` 控制索引提示与预览文案，不是认证。真正访问控制由托管平台设置。

## 可迁移构建

本站使用 GitHub Pages。更新 `main` 分支后，GitHub Actions 自动检查、构建、生成搜索索引并发布。在仓库 Settings → Pages 中选择 GitHub Actions；发布状态在 Actions 中查看。构建失败时不会替换上一版站点。站点地址为 https://elcongroo.github.io/ 。

`SITE_URL` 是 origin，`BASE_PATH` 是网站子路径。GitHub工作流自动读取二者；EdgeOne/Cloudflare根域名部署时设置自己的SITE_URL、BASE_PATH=/、PUBLIC_SITE=true，构建命令 npm run build，输出 dist。

Mermaid图使用 beautiful-mermaid 在构建时生成 SVG，当前示例已验证 sequenceDiagram 子集。它不是完整 Mermaid 渲染器；复杂语法、扩展指令应单独验证，不能静默假定兼容。浏览器不加载 Mermaid 库。

英文优先使用系统 Times New Roman，缺失时依次回退到 Times、Liberation Serif 和衬线字体；中文使用自托管 Noto Serif SC，代码使用 JetBrains Mono。不引用远端字体 CDN。依赖许可证以各包许可证为准。
